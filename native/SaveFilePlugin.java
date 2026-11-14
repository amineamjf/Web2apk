package com.smartrv.app;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Enregistre un fichier dans le dossier public « Téléchargements/SmartRV » du téléphone
 * (visible dans « Mes fichiers », la Galerie pour les images, et le gestionnaire de téléchargements).
 * Utilise MediaStore.Downloads : aucune permission de stockage n'est nécessaire (Android 10+).
 *
 * Méthodes :
 *  - save      : écrit le fichier ; avec overwrite=true, remplace le fichier du même nom (sauvegardes auto)
 *  - openFile  : ouvre le fichier enregistré dans l'application Android adaptée (PDF, Excel…)
 *  - shareFile : feuille de partage Android pour le fichier enregistré
 *  - openFolder: ouvre le gestionnaire de téléchargements
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    private static final String SUB_DIR = "SmartRV";

    /** Cherche un fichier déjà créé par l'app dans Téléchargements/SmartRV. */
    private Uri findExisting(ContentResolver resolver, String name) {
        String[] projection = { MediaStore.MediaColumns._ID };
        String selection = MediaStore.MediaColumns.DISPLAY_NAME + "=? AND "
                + MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        String[] args = { name, Environment.DIRECTORY_DOWNLOADS + "/" + SUB_DIR + "/" };
        try (Cursor c = resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, args, null)) {
            if (c != null && c.moveToFirst()) {
                return ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, c.getLong(0));
            }
        } catch (Exception ignored) {
            // on retombe sur une création normale
        }
        return null;
    }

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        String mime = call.getString("mime", "application/octet-stream");
        boolean overwrite = Boolean.TRUE.equals(call.getBoolean("overwrite", false));

        if (name == null || name.trim().isEmpty() || data == null) {
            call.reject("name et data requis");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("unsupported");
            return;
        }

        Uri created = null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentResolver resolver = getContext().getContentResolver();
            Uri uri = null;

            // Sauvegarde auto : on réécrit le même fichier au lieu d'empiler « nom (1) », « nom (2)… »
            if (overwrite) {
                Uri existing = findExisting(resolver, name);
                if (existing != null) {
                    try (OutputStream os = resolver.openOutputStream(existing, "wt")) {
                        if (os != null) {
                            os.write(bytes);
                            os.flush();
                            uri = existing;
                        }
                    } catch (Exception ignored) {
                        // fichier non modifiable : on en crée un nouveau juste après
                    }
                    if (uri != null) {
                        try {
                            ContentValues touch = new ContentValues();
                            touch.put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000);
                            resolver.update(uri, touch, null, null);
                        } catch (Exception ignored) { }
                    }
                }
            }

            if (uri == null) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + SUB_DIR);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                created = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (created == null) {
                    call.reject("insert failed");
                    return;
                }

                try (OutputStream os = resolver.openOutputStream(created)) {
                    if (os == null) {
                        resolver.delete(created, null, null);
                        call.reject("open failed");
                        return;
                    }
                    os.write(bytes);
                    os.flush();
                }

                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(created, done, null, null);
                uri = created;
            }

            JSObject res = new JSObject();
            res.put("uri", uri.toString());
            res.put("folder", "Download/" + SUB_DIR);
            res.put("name", name);
            res.put("mime", mime);
            res.put("size", bytes.length);
            call.resolve(res);
        } catch (Exception e) {
            // Ne laisse pas un fichier « en attente » à moitié écrit
            if (created != null) {
                try { getContext().getContentResolver().delete(created, null, null); } catch (Exception ignored) { }
            }
            call.reject("save failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String mime = call.getString("mime", "*/*");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("uri requis");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(uriStr), mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no_app");
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String mime = call.getString("mime", "*/*");
        String name = call.getString("name");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("uri requis");
            return;
        }
        try {
            Uri uri = Uri.parse(uriStr);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (name != null && !name.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.setClipData(ClipData.newRawUri("", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "Partager");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openFolder(PluginCall call) {
        try {
            Intent i = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("folder failed: " + e.getMessage());
        }
    }
}
