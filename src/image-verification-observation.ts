import {hash, Problem} from './lib.js';
import {validateVerificationPNG} from './png-validation.js';

/** Fixed metadata only: never persist the provider body, image or error text. */
export function imageVerificationObservation(bytes: Buffer) {
  const png = bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    && bytes.toString('latin1', 12, 16) === 'IHDR';
  return {bytes: bytes.length, sha256: hash(bytes), png,
    width: png ? bytes.readUInt32BE(16) : null,
    height: png ? bytes.readUInt32BE(20) : null};
}

export function validateObservedVerificationPNG(bytes: Buffer) {
  const observed = imageVerificationObservation(bytes);
  if (observed.png && (observed.width !== 1024 || observed.height !== 1024))
    throw new Problem(502, 'AI_IMAGE_DIMENSIONS_MISMATCH', 'The image gateway did not return the requested 1024 by 1024 image');
  try { validateVerificationPNG(bytes); }
  catch { throw new Problem(502, 'AI_IMAGE_PNG_INVALID', 'The image gateway did not return a complete, valid PNG'); }
  return observed;
}
