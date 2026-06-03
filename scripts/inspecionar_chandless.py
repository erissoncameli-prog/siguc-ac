import shapefile, os
BASE = r"C:\Users\eriss\OneDrive\Documents\OneDrive\Documents\Dima OneDrive\Gestão de UCs\Gestão Florestal na Amazônia Legal\Parque Estadual Chandless\DADOS RENOMEADOS"
shp = os.path.join(BASE, "zoneamento5.shp")
sf = shapefile.Reader(shp, encoding='latin-1')
fields = [f[0] for f in sf.fields[1:]]
print("Campos:", fields)
print("Registros:")
for sr in sf.shapeRecords():
    rec = dict(zip(fields, sr.record))
    print(" ", rec, "| shapeType:", sr.shape.shapeType)
