import { pipeline } from "@xenova/transformers";

let cachedPipe;

async function getPipe() {
  if (!cachedPipe) {
    cachedPipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      quantized: true
    });
  }
  return cachedPipe;
}

function normalize(vector) {
  let sumSquares = 0;
  for (const value of vector) {
    sumSquares += value * value;
  }
  const scale = 1 / Math.sqrt(sumSquares || 1);
  return Float32Array.from(vector, (value) => value * scale);
}

export async function embed(text) {
  const pipe = await getPipe();
  const output = await pipe(text, { pooling: "mean", normalize: false });
  const data = output?.data ?? output;
  return normalize(Array.from(data));
}

export { normalize };
