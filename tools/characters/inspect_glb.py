import json, struct, sys

path = sys.argv[1]
with open(path, "rb") as f:
    magic, ver, length = struct.unpack("<III", f.read(12))
    clen, ctype = struct.unpack("<II", f.read(8))
    gltf = json.loads(f.read(clen))

print("meshes:", len(gltf.get("meshes", [])))
print("nodes:", len(gltf.get("nodes", [])))
print("skins:", len(gltf.get("skins", [])))
if gltf.get("skins"):
    s = gltf["skins"][0]
    joints = s["joints"]
    names = [gltf["nodes"][j].get("name", "?") for j in joints]
    print("joints:", len(joints))
print("animations:", [a.get("name") for a in gltf.get("animations", [])])
print("materials:")
for m in gltf.get("materials", []):
    pbr = m.get("pbrMetallicRoughness", {})
    print(" ", m.get("name"), pbr.get("baseColorFactor"), "emis=", m.get("emissiveFactor"))
imgs = gltf.get("images", [])
print("images:", len(imgs))
# primitive/vertex counts
total_v = 0
for m in gltf.get("meshes", []):
    for p in m["primitives"]:
        total_v += gltf["accessors"][p["attributes"]["POSITION"]]["count"]
print("total verts:", total_v)
