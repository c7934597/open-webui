/** Keep company Azure transcription authoritative over saved browser preferences. */
export const shouldUseWebSpeech = (globalEngine: string, preferredEngine?: string): boolean =>
	globalEngine !== 'azure' && (globalEngine === 'web' || preferredEngine === 'web');

/** Temporary audio attachments use STT without creating a persistent file record. */
export const getTemporaryAttachmentContent = async (
	file: File,
	globalEngine: string | undefined,
	transcribe: (file: File) => Promise<{ text: string }>,
	extract: (file: File) => Promise<unknown>
) => {
	const mimeType = file.type.split(';')[0].trim().toLowerCase();
	if (
		globalEngine === 'azure' &&
		(mimeType.startsWith('audio/') || mimeType === 'video/webm')
	) {
		const result = await transcribe(file);
		if (typeof result?.text !== 'string' || !result.text.trim()) {
			throw new Error('Audio transcription returned no text.');
		}
		return result.text;
	}
	return extract(file);
};
