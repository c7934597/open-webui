import { describe, expect, it, vi } from 'vitest';
import { getTemporaryAttachmentContent, shouldUseWebSpeech } from './speechToText';

describe('speech-to-text provider selection', () => {
	it('sends users with an existing Web API preference to company Azure', () => {
		expect(shouldUseWebSpeech('azure', 'web')).toBe(false);
	});

	it.each([undefined, '', 'azure'])('uses server transcription for Azure with preference %s', (preference) => {
		expect(shouldUseWebSpeech('azure', preference)).toBe(false);
	});

	it.each(['', 'openai', 'deepgram', 'mistral'])('preserves Web API preference when the global engine is %s', (engine) => {
		expect(shouldUseWebSpeech(engine, 'web')).toBe(true);
		expect(shouldUseWebSpeech(engine)).toBe(false);
	});

	it('preserves the global Web API setting', () => {
		expect(shouldUseWebSpeech('web')).toBe(true);
	});
});

describe('temporary Azure audio attachments', () => {
	it.each(['audio/wav', 'audio/mpeg', 'audio/webm;codecs=opus', 'video/webm;codecs=opus'])(
		'transcribes %s instead of reading binary content as text',
		async (type) => {
			const file = new File(['RIFF binary audio'], 'recording.wav', { type });
			const transcribe = vi.fn().mockResolvedValue({ text: '公司 Azure 語音驗收' });
			const extract = vi.fn().mockResolvedValue('RIFF binary audio');
			await expect(getTemporaryAttachmentContent(file, 'azure', transcribe, extract))
				.resolves.toBe('公司 Azure 語音驗收');
			expect(transcribe).toHaveBeenCalledOnce();
			expect(transcribe).toHaveBeenCalledWith(file);
			expect(extract).not.toHaveBeenCalled();
		}
	);

	it('propagates an Azure failure without falling back to binary text extraction', async () => {
		const file = new File(['RIFF binary audio'], 'recording.wav', { type: 'audio/wav' });
		const error = new Error('Azure unavailable');
		const transcribe = vi.fn().mockRejectedValue(error);
		const extract = vi.fn();
		await expect(getTemporaryAttachmentContent(file, 'azure', transcribe, extract)).rejects.toBe(error);
		expect(extract).not.toHaveBeenCalled();
	});

	it.each([null, {}, { text: '' }, { text: '   ' }])('rejects an unusable transcription result %j', async (result) => {
		const file = new File(['RIFF binary audio'], 'recording.wav', { type: 'audio/wav' });
		const transcribe = vi.fn().mockResolvedValue(result);
		const extract = vi.fn();
		await expect(getTemporaryAttachmentContent(file, 'azure', transcribe, extract))
			.rejects.toThrow('Audio transcription returned no text.');
			expect(extract).not.toHaveBeenCalled();
	});

	it('preserves local extraction for a temporary text attachment', async () => {
		const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
		const transcribe = vi.fn();
		const extract = vi.fn().mockResolvedValue('hello');
		await expect(getTemporaryAttachmentContent(file, 'azure', transcribe, extract)).resolves.toBe('hello');
		expect(transcribe).not.toHaveBeenCalled();
	});

	it('preserves existing behavior for other global engines', async () => {
		const file = new File(['content'], 'recording.wav', { type: 'audio/wav' });
		const transcribe = vi.fn();
		const extract = vi.fn().mockResolvedValue('existing behavior');
		await expect(getTemporaryAttachmentContent(file, 'openai', transcribe, extract)).resolves.toBe('existing behavior');
		expect(transcribe).not.toHaveBeenCalled();
	});
});
