import zipfile, sys
from xml.parsers import expat
import xml.sax, io
z = zipfile.ZipFile('out/export.xlsx')
bad = 0
print('parts:', len(z.namelist()))
for n in z.namelist():
    info = z.getinfo(n)
    if n.endswith('.xml') or n.endswith('.rels'):
        d = z.read(n)
        p = expat.ParserCreate()
        try:
            p.Parse(d, True)
        except Exception as e:
            bad += 1
            print('XML INVALIDE', n, e)
            try:
                line, col = p.ErrorLineNumber, p.ErrorColumnNumber
                txt = d.decode('utf-8', 'replace').split('\n')[line-1]
                print('   autour:', repr(txt[max(0, col-120):col+120]))
            except Exception as e2:
                print('   (contexte indisponible)', e2)
    print(' ', n, info.compress_type, 'flag', hex(info.flag_bits), info.file_size)
# reproduction du lecteur du clavier : toutes les feuilles xl/worksheets/sheet*.xml
for n in sorted(z.namelist()):
    if n.startswith('xl/worksheets/sheet') and n.endswith('.xml'):
        try:
            xml.sax.parse(io.BytesIO(z.read(n)), xml.sax.ContentHandler())
        except Exception as e:
            bad += 1; print('SAX ECHEC', n, e)
print('RESULTAT:', 'PROBLEMES=%d' % bad)
sys.exit(1 if bad else 0)
