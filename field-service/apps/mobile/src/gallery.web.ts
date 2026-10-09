export class GalleryDeniedError extends Error {}

/** Web: download the PNG instead of saving to a photo gallery. */
export async function savePngToGallery(dataUri: string, name: string): Promise<void> {
  const link = document.createElement('a');
  link.href = dataUri;
  link.download = `${name.replace(/[^a-zA-Z0-9-]/g, '')}.png`;
  link.click();
}
