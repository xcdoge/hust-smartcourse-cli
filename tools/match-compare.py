# 在 80 张标注样本上比较几种匹配策略
from PIL import Image, ImageSequence
import glob, os, json

W, H = 90, 58
TH = 200
N = 24
LABELS = json.load(open('state/labels.json', encoding='utf-8'))


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


def bits_of(c, x0, x1):
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


def shift(ft, dx, dy):
    """把 NxN 位图平移 (dx,dy)"""
    out = [0] * (N * N)
    for y in range(N):
        for x in range(N):
            nx, ny = x + dx, y + dy
            if 0 <= nx < N and 0 <= ny < N and ft[y * N + x]:
                out[ny * N + nx] = 1
    return out


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
        b = bits_of(c, x0, x1)
        if b:
            data.append((ch, b, key))

print(f'样本 {len(data)}')


def ham(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)


def evaluate(predict):
    right = 0
    for i, (ch, ft, key) in enumerate(data):
        pool = [(c2, f2) for j, (c2, f2, k2) in enumerate(data) if k2 != key]
        if predict(ft, pool) == ch:
            right += 1
    return right / len(data)


def p_1nn(ft, pool):
    return min(pool, key=lambda p: ham(ft, p[1]))[0]


def p_3nn(ft, pool):
    ds = sorted(((ham(ft, f2), c2) for c2, f2 in pool))[:3]
    votes = {}
    for d, c2 in ds:
        votes[c2] = votes.get(c2, 0) + 1
    return max(votes.items(), key=lambda kv: kv[1])[0]


def p_1nn_shift(ft, pool):
    """允许 ±1 像素平移，取最小距离"""
    best, bd = None, 10 ** 9
    for c2, f2 in pool:
        d = min(ham(ft, f2), ham(ft, shift(f2, 1, 0)), ham(ft, shift(f2, -1, 0)),
                ham(ft, shift(f2, 0, 1)), ham(ft, shift(f2, 0, -1)))
        if d < bd:
            bd, best = d, c2
    return best


for name, fn in [('1-NN', p_1nn), ('3-NN 投票', p_3nn), ('1-NN + ±1 平移', p_1nn_shift)]:
    a = evaluate(fn)
    print(f'{name:<18} {a*100:5.1f}%/位   整图 {a**4*100:5.1f}%')
