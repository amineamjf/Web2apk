"""Force Gradle à signer l'APK de debug avec debug.keystore (clé FIXE du dépôt).

Copier debug.keystore dans ~/.android ne suffisait pas : l'APK sortait signé avec une clé aléatoire
différente à chaque build, et Android refusait la mise à jour par-dessus l'ancienne version.
"""
import sys

p = "android/app/build.gradle"
s = open(p, encoding="utf-8").read()
blk = '''    signingConfigs {
        debug {
            storeFile file("../../debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
'''
if "    buildTypes {" not in s:
    sys.exit("buildTypes introuvable dans android/app/build.gradle")
if "storeFile file(\"../../debug.keystore\")" in s:
    sys.exit(0)
s = s.replace("    buildTypes {", blk + "    buildTypes {", 1)
open(p, "w", encoding="utf-8").write(s)
print("signingConfigs.debug -> debug.keystore")
