// downscale ships no types. Only its default export is used, without `returnBlob`, so it resolves to a data URL.
declare module 'downscale' {
	const downscale: (
		source: Blob | HTMLImageElement | HTMLVideoElement | string,
		width: number,
		height: number,
		options?: { imageType?: string; quality?: number; returnBlob?: boolean; returnCanvas?: boolean }
	) => Promise<string>
	export default downscale
}
