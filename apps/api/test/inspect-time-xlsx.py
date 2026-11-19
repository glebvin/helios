"""Independent stdlib-only inspection of the actual HTTP workbook, not writer input."""
import json, posixpath, sys, zipfile
import xml.etree.ElementTree as ET
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    assert '[Content_Types].xml' in z.namelist()
    for name in z.namelist():
        if name.endswith('.xml'):
            with z.open(name) as xml:
                for _,element in ET.iterparse(xml,events=('end',)):
                    assert element.tag!='{'+N['s']+'}f', 'Unexpected formula'
                    element.clear()
    rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    strings=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        strings=[''.join(t.itertext()) for t in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',N)]
    styles=ET.fromstring(z.read('xl/styles.xml'))
    formats={f.attrib['numFmtId']:f.attrib['formatCode'] for f in styles.findall('s:numFmts/s:numFmt',N)}
    cell_styles=styles.findall('s:cellXfs/s:xf',N)
    result={}
    for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',N):
        target=rels[sheet.attrib['{'+N['r']+'}id']]
        target=target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl',target))
        assert target.startswith('xl/worksheets/') and target in z.namelist()
        rows=[]
        with z.open(target) as xml:
            for _,row in ET.iterparse(xml,events=('end',)):
                if row.tag!='{'+N['s']+'}row': continue
                values=[]
                for c in row.findall('s:c',N):
                    t=c.attrib.get('t','n'); v=c.find('s:v',N)
                    raw=v.text if v is not None else ''
                    if t=='s': value=strings[int(raw)]
                    elif t=='inlineStr': value=''.join(c.find('s:is',N).itertext())
                    else: value=raw
                    values.append({'value':value,'type':t,'style':c.attrib.get('s')})
                rows.append(values)
                row.clear()
        result[sheet.attrib['name']]=rows
    assert set(result)=={'Time','Snapshot'}
    assert result['Time'] and len(result['Time'][0])==34
    # Every identifier/label/raw exact ms is typed as a string. Numeric hours/revision
    # and Boolean override are the only other types.
    for row in result['Time'][1:]:
        assert len(row)==34
        for i,c in enumerate(row):
            if i==6 or i>=14 and i%2==1:
                assert c['type']=='n'
                if i>=14: assert formats[cell_styles[int(c['style'])].attrib['numFmtId']]=='0.000000'
            elif i==12: assert c['type']=='b'
            else: assert c['type'] in ('s','inlineStr')
    print(json.dumps(result,ensure_ascii=True))
