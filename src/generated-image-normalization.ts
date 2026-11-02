import {PNG} from 'pngjs';
import {Problem} from './lib.js';
import {decodeBoundedGatewayPNG,validateVerificationPNG} from './png-validation.js';
import {imageVerificationObservation} from './image-verification-observation.js';

/** Normalize only fully decoded square PNGs between 1024 and 2048 pixels.
 * The requested output, aspect ratio, billable image count and original hash
 * remain explicit. Malformed/oversized images never reach the resampler. */
export function normalizeGeneratedImagePNG(input: Buffer) {
  const source=imageVerificationObservation(input);
  let decoded: ReturnType<typeof decodeBoundedGatewayPNG>;
  try { decoded=decodeBoundedGatewayPNG(input); }
  catch {
    const dimensions=source.png && (source.width!==source.height || (source.width??0)<1024 || (source.width??0)>2048);
    throw new Problem(502,dimensions?'AI_IMAGE_DIMENSIONS_MISMATCH':'AI_IMAGE_PNG_INVALID',
      dimensions?'A square PNG between 1024 and 2048 pixels is required':'The image gateway did not return a complete, valid PNG');
  }
  if(decoded.width===1024)return {bytes:input,source,output:source,normalized:false};
  const output=new PNG({width:1024,height:1024}), side=decoded.width, scale=side/1024;
  for(let y=0;y<1024;y++){
    const sy=(y+0.5)*scale-0.5,y0=Math.floor(sy),y1=Math.min(y0+1,side-1),fy=sy-y0;
    for(let x=0;x<1024;x++){
      const sx=(x+0.5)*scale-0.5,x0=Math.floor(sx),x1=Math.min(x0+1,side-1),fx=sx-x0;
      const offsets=[(y0*side+x0)*4,(y0*side+x1)*4,(y1*side+x0)*4,(y1*side+x1)*4];
      const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
      let alpha=0,r=0,g=0,b=0;
      for(let k=0;k<4;k++){
        const i=offsets[k],weightedAlpha=decoded.data[i+3]*weights[k];
        alpha+=weightedAlpha;r+=decoded.data[i]*weightedAlpha;g+=decoded.data[i+1]*weightedAlpha;b+=decoded.data[i+2]*weightedAlpha;
      }
      const at=(y*1024+x)*4;
      output.data[at]=alpha?Math.round(r/alpha):0;output.data[at+1]=alpha?Math.round(g/alpha):0;
      output.data[at+2]=alpha?Math.round(b/alpha):0;output.data[at+3]=Math.round(alpha);
    }
  }
  const bytes=PNG.sync.write(output);
  validateVerificationPNG(bytes);
  return {bytes,source,output:imageVerificationObservation(bytes),normalized:true};
}
