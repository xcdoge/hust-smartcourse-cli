# 方案：不做缩放，裁紧后居中补到 24x24 —— Python 与 Node 可实现完全一致
from PIL import Image, ImageSequence
import glob, os, json

W, H = 90, 58
TH = 200
N = 24

LABELS = {
    'cap-001': '6339', 'cap-002': '3335', 'cap-003': '2916', 'cap-004': '4711', 'cap-005': '0511',
    'cap-006': '2809', 'cap-007': '6772', 'cap-008': '7835', 'cap-009': '0266', 'cap-010': '8442',
    'cap-011': '3558', 'cap-012': '9665', 'cap-013': '1140', 'cap-014': '2910', 'cap-015': '8777',
    'cap-016': '7634', 'cap-017': '8202', 'cap-018': '4527', 'cap-019': '7717', 'cap-020': '3043',
    'cap-021': '0931', 'cap-022': '2743', 'cap-023': '8520', 'cap-024': '2577', 'cap-025': '1740',
    'cap-026': '1978', 'cap-027': '0807', 'cap-028': '9766', 'cap-029': '2161', 'cap-030': '2925',
    'cap-031': '9722', 'cap-032': '8551', 'cap-033': '2894', 'cap-034': '6644', 'cap-035': '3697',
    'cap-036': '0794', 'cap-037': '1103', 'cap-038': '2895', 'cap-039': '1558', 'cap-040': '6644',
    'cap-041': '8139', 'cap-042': '1346', 'cap-043': '9876', 'cap-044': '9325', 'cap-045': '2487',
    'cap-046': '8134', 'cap-047': '3914', 'cap-048': '0138', 'cap-049': '0515', 'cap-050': '5526',
    'cap-051': '1304', 'cap-052': '0816', 'cap-053': '7191', 'cap-054': '1666', 'cap-055': '2794',
    'cap-056': '6557', 'cap-057': '0073', 'cap-058': '3794', 'cap-059': '9514', 'cap-060': '0663',
    'cap-061': '9056', 'cap-062': '1269', 'cap-063': '1958', 'cap-064': '7085', 'cap-065': '1386',
    'cap-066': '2829', 'cap-067': '9449', 'cap-068': '2480', 'cap-069': '1057', 'cap-070': '3346',
    'cap-071': '9927', 'cap-072': '5476', 'cap-073': '7799', 'cap-074': '5510', 'cap-075': '6462',
    'cap-076': '7023', 'cap-077': '8446', 'cap-078': '5311', 'cap-079': '9373', 'cap-080': '7126',
}


def canvas_of(path):
    im = Image.open(path)
    frames = []
    for fr in ImageSequence.Iterator(im):
        px = fr.convert('RGB').load()
        m = bytearray(W * H)
        for y in range(H):
            for x in range(W):
                r, g, b = px[x, y]
                m[y * W + x] = 1 if (r * 0.3 + g * 0.59 + b * 0.11) < TH else 0
        frames.append(m)
    n = min(len(frames), 4)
    c = bytearray(W * H)
    for i in range(W * H):
        c[i] = 1 if sum(frames[j][i] for j in range(n)) > 1 else 0
    return c


def bands(c, minw=5):
    on = [sum(c[y * W + x] for y in range(H)) >= 2 for x in range(W)]
    out, start = [], None
    for x, v in enumerate(on):
        if v and start is None:
            start = x
        elif not v and start is not None:
            if x - start >= minw:
                out.append((start, x))
            start = None
    if start is not None and W - start >= minw:
        out.append((start, W))
    return out


def cellbits(c, x0, x1):
    """裁紧包围盒，居中放到 NxN（不缩放）"""
    ys = [y for y in range(H) if any(c[y * W + x] for x in range(x0, x1))]
    if not ys:
        return None
    y0, y1 = min(ys), max(ys) + 1
    w, h = x1 - x0, y1 - y0
    grid = [[0] * N for _ in range(N)]
    ox, oy = (N - w) // 2, (N - h) // 2
    for y in range(y0, y1):
        for x in range(x0, x1):
            if c[y * W + x]:
                gx, gy = x - x0 + ox, y - y0 + oy
                if 0 <= gx < N and 0 <= gy < N:
                    grid[gy][gx] = 1
    return [v for row in grid for v in row]


data = []
for f in sorted(glob.glob('state/captchas/*.gif')):
    key = os.path.basename(f).replace('.gif', '')
    label = LABELS.get(key)
    if not label:
        continue
    c = canvas_of(f)
    bs = bands(c)
    if len(bs) != 4:
        continue
    for (x0, x1), ch in zip(bs, label):
        b = cellbits(c, x0, x1)
        if b:
            data.append((ch, b, key))

print(f'样本 {len(data)}')

def ham(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)

right = 0
wrong = []
for i, (ch, ft, key) in enumerate(data):
    best, bd = None, 10 ** 9
    for j, (ch2, ft2, _) in enumerate(data):
        if i == j:
            continue
        d = ham(ft, ft2)
        if d < bd:
            bd, best = d, ch2
    if best == ch:
        right += 1
    else:
        wrong.append(f'{key} 期望{ch} 得{best}(d={bd})')
acc = right / len(data)
print(f'1-NN 留一: {right}/{len(data)} = {acc*100:.1f}%/位，整张 {acc**4*100:.1f}%')
for w in wrong[:8]:
    print('  ' + w)

model = {'N': N, 'samples': [[ch, ft, key] for ch, ft, key in data]}
json.dump(model, open('state/captcha-model.json', 'w'))
print('已写 state/captcha-model.json')
