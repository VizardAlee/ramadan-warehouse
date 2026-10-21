/** Only a user-selected PNG is decoded. No page capture, URLs, logs or original filename. */
export async function prepareSupportScreenshot(file: File) {
  if (file.type !== "image/png" || file.size > 5 * 1024 * 1024) throw new Error("Choose a cropped PNG no larger than 5 MB. Remove private details before attaching it.");
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer()), view = new DataView(header.buffer);
  if (header.length < 24 || ![137,80,78,71,13,10,26,10].every((n,i) => header[i] === n)) throw new Error("Choose a valid PNG screenshot.");
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8000 || height > 8000 || width * height > 16000000) throw new Error("Crop the screenshot before attaching it; the image is too large.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.floor(bitmap.width * scale)); canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
      const context = canvas.getContext("2d"); if (!context) throw new Error("This browser cannot prepare the screenshot. Send the text report without it.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png"), base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (base64.length <= Math.ceil(128 * 1024 / 3) * 4) return { base64, preview: dataUrl };
      scale *= 0.75;
    }
    throw new Error("Crop a smaller area so the prepared PNG is 128 KB or less.");
  } finally { bitmap.close(); }
}
