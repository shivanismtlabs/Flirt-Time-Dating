import sharp from 'sharp';

/**
 * Creates a valid JPEG image buffer containing a clear single face illustration
 */
export const createSingleFaceImage = async (
  width = 400,
  height = 400,
  options: { isDark?: boolean; isBright?: boolean; isBlurry?: boolean } = {}
): Promise<Buffer> => {
  const bg = options.isDark ? '#101010' : options.isBright ? '#fefefe' : '#d0e0f0';
  const skin = options.isDark ? '#2a1a15' : options.isBright ? '#fff5f0' : '#e8beac';

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${bg}" />
      <ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.28}" ry="${height * 0.35}" fill="${skin}" stroke="#b37d64" stroke-width="4" />
      <ellipse cx="${width * 0.38}" cy="${height * 0.42}" rx="18" ry="12" fill="#ffffff" stroke="#333" stroke-width="2" />
      <circle cx="${width * 0.38}" cy="${height * 0.42}" r="7" fill="#222" />
      <ellipse cx="${width * 0.62}" cy="${height * 0.42}" rx="18" ry="12" fill="#ffffff" stroke="#333" stroke-width="2" />
      <circle cx="${width * 0.62}" cy="${height * 0.42}" r="7" fill="#222" />
      <path d="M ${width * 0.33} ${height * 0.37} Q ${width * 0.38} ${height * 0.34} ${width * 0.43} ${height * 0.36}" stroke="#4a2e18" stroke-width="6" fill="none" stroke-linecap="round" />
      <path d="M ${width * 0.57} ${height * 0.36} Q ${width * 0.62} ${height * 0.34} ${width * 0.67} ${height * 0.37}" stroke="#4a2e18" stroke-width="6" fill="none" stroke-linecap="round" />
      <path d="M ${width * 0.5} ${height * 0.45} L ${width * 0.48} ${height * 0.53} L ${width * 0.52} ${height * 0.53} Z" fill="#d29f8c" />
      <ellipse cx="${width * 0.5}" cy="${height * 0.65}" rx="${width * 0.1}" ry="12" fill="#c45b5b" />
    </svg>
  `;

  let pipeline = sharp(Buffer.from(svg));
  if (options.isBlurry) {
    pipeline = pipeline.blur(15);
  }
  return pipeline.jpeg({ quality: 90 }).toBuffer();
};

/**
 * Creates a PNG/JPEG blank image without any faces
 */
export const createBlankImage = async (width = 400, height = 400, format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<Buffer> => {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 140, b: 180 },
    },
  });

  if (format === 'png') return pipeline.png().toBuffer();
  if (format === 'webp') return pipeline.webp().toBuffer();
  return pipeline.jpeg().toBuffer();
};

/**
 * Creates an image with two distinct faces
 */
export const createMultiFaceImage = async (width = 600, height = 400): Promise<Buffer> => {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#d0e0f0" />
      <!-- Face 1 -->
      <g transform="translate(120, 200)">
        <ellipse cx="0" cy="0" rx="70" ry="90" fill="#e8beac" />
        <circle cx="-25" cy="-20" r="8" fill="#222" />
        <circle cx="25" cy="-20" r="8" fill="#222" />
        <ellipse cx="0" cy="35" rx="20" ry="8" fill="#c45b5b" />
      </g>
      <!-- Face 2 -->
      <g transform="translate(480, 200)">
        <ellipse cx="0" cy="0" rx="70" ry="90" fill="#d8ae9c" />
        <circle cx="-25" cy="-20" r="8" fill="#222" />
        <circle cx="25" cy="-20" r="8" fill="#222" />
        <ellipse cx="0" cy="35" rx="20" ry="8" fill="#b44b4b" />
      </g>
    </svg>
  `;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
};

/**
 * Creates a corrupted image buffer (invalid bytes with fake JPEG header)
 */
export const createCorruptedImageBuffer = (): Buffer => {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const garbage = Buffer.alloc(100, 0x00);
  return Buffer.concat([header, garbage]);
};
