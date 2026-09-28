# Pack the fitted table into Kilr's runtime format (see src/kilr/embed.js): int8 rows with a float32 scale each.
import sys, struct, numpy as np
E = np.load(sys.argv[1]).astype(np.float32)
out = sys.argv[2]
V, D = E.shape
scale = np.abs(E).max(1) / 127; scale[scale == 0] = 1
q = np.clip(np.round(E / scale[:, None]), -127, 127).astype(np.int8)
with open(out, 'wb') as f:
    f.write(b'KLR1'); f.write(struct.pack('<II', V, D)); f.write(scale.astype('<f4').tobytes()); f.write(q.tobytes())
print(out, V, D, f'{(12 + V*4 + V*D)/1e6:.1f} MB')
