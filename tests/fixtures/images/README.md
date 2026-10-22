# Image decoder fixtures

Run `CHROMIUM_PATH=/usr/bin/chromium npm run build:fixtures` (or omit CHROMIUM_PATH for Playwright's bundled Chromium). The script paints four exact solid RGB quadrants: red top-left, green top-right, blue bottom-left, yellow bottom-right. Orientation 6/8 JPEGs start as 300×200 browser-encoded JPEGs, then receive a losslessly inserted Exif APP1 segment with a little-endian TIFF IFD orientation SHORT of 6 or 8. No pixel rotation occurs in fixture generation. Import must decode to 200×300 exactly once. JPEG sampled interior channels allow absolute error ≤8; lossless PNG has no tolerance.

Transparent is a fully transparent PNG. Landscape and portrait are 2000×1000 and 1000×2000 PNGs; extreme is 10000×1 (valid, no artificial aspect limit). `too-many-pixels.png` is deliberately header-only, declaring 80,000,001×1: it must fail on declared dimensions before decoding or allocation. The 25,000,001-byte blob and malformed magic inputs are generated in the tests rather than committed as large files.

JSON sidecars document fixture source dimensions and orientation; tests assert independently specified corner order. Original bytes must remain byte-for-byte unchanged. All fixtures are original synthetic test artwork with no third-party image license dependencies.
