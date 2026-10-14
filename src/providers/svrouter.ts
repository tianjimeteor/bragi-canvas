import type { App, RequestUrlResponse } from 'obsidian'
import { requestUrl } from 'obsidian'
import type { ImageProvider, GenerateImageResult, VideoProvider, GenerateVideoResult } from './types'
import { uploadRef } from './upload'
import { stringParam } from './params'

const POLL_INTERVAL_MS = 3000
const MAX_IMAGE_WAIT_MS = 20 * 60 * 1000

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {}
}

function errorMessage(value: unknown): string {
	if (typeof value === 'string') return value
	const error = record(value)
	return typeof error.message === 'string' ? error.message : 'no reason provided'
}

/** Accept either a gateway origin or an already-versioned /v1 base URL. */
export function svrouterApiBase(baseUrl: string): string {
	let url: URL
	try { url = new URL(baseUrl.trim()) } catch { throw new Error('svrouter: enter a valid gateway HTTP(S) base URL.') }
	if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error('svrouter: enter a gateway HTTP(S) base URL without credentials, query, or fragment.')
	}
	const base = url.toString().replace(/\/+$/, '')
	return base.endsWith('/v1') ? base : `${base}/v1`
}

/** Local/private addresses and provider-specific asset IDs cannot be fetched upstream. */
function publicMediaUrl(value: string, httpsOnly = false): string {
	let url: URL
	try { url = new URL(value) } catch { throw new Error('svrouter: reference media must have a public HTTP(S) URL.') }
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
	const privateV4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)
	const privateV6 = host.includes(':') && (/^(?:::|fc|fd|fe[89ab])/.test(host) || host.startsWith('::ffff:'))
	if (!(httpsOnly ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)) || url.username || url.password
		|| !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
		|| host.endsWith('.internal') || privateV4 || privateV6) {
		throw new Error(`svrouter: reference media must have a public ${httpsOnly ? 'HTTPS' : 'HTTP(S)'} URL reachable by the gateway upstream.`)
	}
	return value
}

function stringList(value: unknown): string[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
		throw new Error('svrouter: reference media must be a list of URLs or data URLs.')
	}
	return value as string[]
}

async function prepareMedia(value: string, httpsOnly = false): Promise<string> {
	const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/)
	if (!match) return publicMediaUrl(value, httpsOnly)
	const mime = match[1]
	const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }
	const ext = extensions[mime]
	if (!ext) throw new Error('svrouter: unsupported reference media type.')
	const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
	const url = await uploadRef(undefined, bytes.buffer, `ref.${ext}`, mime)
	return publicMediaUrl(url, httpsOnly)
}

function assertResponse(response: RequestUrlResponse): void {
	if (response.status < 200 || response.status >= 300) {
		const body = record(response.json)
		throw new Error(`svrouter: HTTP ${response.status} — ${errorMessage(body.error ?? body.message)}`)
	}
}

class SvRouterClient {
	protected readonly baseUrl: string
	constructor(baseUrl: string, protected readonly token: string, protected readonly app: App, protected readonly outputDir: string) {
		this.baseUrl = svrouterApiBase(baseUrl)
		if (!token.trim()) throw new Error('svrouter: add your gateway token in provider settings.')
	}

	protected async request(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
		const response = await requestUrl({
			url: `${this.baseUrl}${path}`, method: body ? 'POST' : 'GET',
			headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
			...(body ? { body: JSON.stringify(body) } : {}), throw: false,
		})
		assertResponse(response)
		return record(response.json)
	}

	protected async download(url: string, ext: string, authenticated = false): Promise<string> {
		const response = await requestUrl({ url, ...(authenticated ? { headers: { Authorization: `Bearer ${this.token}` } } : {}), throw: false })
		assertResponse(response)
		const type = response.headers['content-type']?.split(';')[0].toLowerCase()
		const imageExt: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
		const actualExt = imageExt[type] || ext
		const prefix = actualExt === 'mp4' ? 'vid' : 'img'
		const filePath = `${this.outputDir}/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${actualExt}`
		const adapter = this.app.vault.adapter
		if (!await adapter.exists(this.outputDir)) await adapter.mkdir(this.outputDir)
		await adapter.writeBinary(filePath, response.arrayBuffer)
		return filePath
	}
}

export class SvRouterImageProvider extends SvRouterClient implements ImageProvider {
	name = 'svrouter Image'

	async generateImage(prompt: string, params: Record<string, unknown> = {}): Promise<GenerateImageResult> {
		const refImages = stringList(params.refImages ?? params.image_urls)
		if (refImages.length > 16) throw new Error('svrouter: GPT Image 2.5 supports up to 16 reference images.')
		if (params.mask_url !== undefined && !refImages.length) throw new Error('svrouter: a mask requires a reference image.')
		const format = stringParam(params.output_format, 'png')
		if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('svrouter: output format must be png, jpeg, or webp.')
		if (params.background === 'transparent' && format === 'jpeg') throw new Error('svrouter: transparent backgrounds require PNG or WebP output.')
		if (params.output_compression !== undefined && (typeof params.output_compression !== 'number' || !Number.isInteger(params.output_compression) || params.output_compression < 0 || params.output_compression > 100)) {
			throw new Error('svrouter: output compression must be an integer from 0 to 100.')
		}
		const tier = stringParam(params.resolution ?? params.imageSize, '2k').toLowerCase()
		const body: Record<string, unknown> = {
			model: stringParam(params.modelId, 'sv-gpt-image-2.5-flare'), prompt, n: 1,
			size: stringParam(params.size ?? params.aspectRatio, '1:1'), resolution: tier === 'auto' ? '2k' : tier,
		}
		for (const key of ['quality', 'background', 'moderation', 'output_format', 'output_compression']) {
			if (params[key] !== undefined) body[key] = params[key]
		}
		if (refImages.length) body.image_urls = await Promise.all(refImages.map(image => prepareMedia(image)))
		if (params.mask_url !== undefined) body.mask_url = await prepareMedia(stringParam(params.mask_url, ''))
		const task = await this.request('/images/tasks', body)
		const taskId = stringParam(task.id ?? task.task_id, '')
		if (!taskId) throw new Error('svrouter: image task response has no task id.')
		const deadline = Date.now() + MAX_IMAGE_WAIT_MS
		let current = task
		while (Date.now() < deadline) {
			if (current.status === 'completed') {
				const first = Array.isArray(current.data) ? record(current.data[0]) : {}
				if (typeof first.url !== 'string' || !first.url) throw new Error('svrouter: completed task has no image URL.')
				return { filePath: await this.download(publicMediaUrl(first.url), format === 'jpeg' ? 'jpg' : format) }
			}
			if (current.status === 'failed' || current.status === 'cancelled') throw new Error(`svrouter: image task failed — ${errorMessage(current.error)}`)
			if (!['queued', 'pending', 'in_progress', 'processing', 'running'].includes(stringParam(current.status, ''))) {
				throw new Error('svrouter: invalid image task status.')
			}
			await new Promise<void>(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS))
			current = await this.request(`/images/tasks/${encodeURIComponent(taskId)}`)
		}
		throw new Error(`svrouter: image task ${taskId} timed out after ${MAX_IMAGE_WAIT_MS / 60000} minutes.`)
	}
}

export class SvRouterVideoProvider extends SvRouterClient implements VideoProvider {
	name = 'svrouter Video'

	async generateVideo(prompt: string, params: Record<string, unknown> = {}): Promise<GenerateVideoResult> {
		for (const key of ['resolution', 'generate_audio', 'continue_from_clip_id']) {
			if (params[key] !== undefined) throw new Error(`svrouter: Reactor parameter ${key} is unsupported for independent jobs.`)
		}
		const images = stringList(params.refImages ?? params.reference_images)
		const audios = stringList(params.refAudios ?? params.reference_audios)
		if (images.length > 9) throw new Error('svrouter: Reactor supports up to 9 reference images.')
		if (audios.length > 3) throw new Error('svrouter: Reactor supports up to 3 reference audios.')
		if (stringList(params.refVideos).length) throw new Error('svrouter: Reactor does not support video references or continuation between jobs.')
		if (audios.length && !images.length) throw new Error('svrouter: Reactor audio references require a reference image.')
		const mode = stringParam(params.genMode, 'text-to-video')
		if (!['text-to-video', 'first-frame', 'first-last-frame', 'multi-image-ref', 'image-ref'].includes(mode)) {
			throw new Error('svrouter: unsupported Reactor generation mode.')
		}
		if (mode === 'first-frame' && !images.length) throw new Error('svrouter: first-frame mode requires a reference image.')
		if (mode === 'first-last-frame' && images.length < 2) throw new Error('svrouter: first-last-frame mode requires two reference images.')
		const seconds = Number(params.duration ?? params.seconds ?? 14.375)
		if (![5.875, 8, 10.125, 12.25, 14.375].includes(seconds)) throw new Error('svrouter: Reactor duration must be 5.875, 8, 10.125, 12.25, or 14.375 seconds.')
		const canvas = stringParam(params.aspectRatio ?? params.canvas, '16:9')
		if (!['16:9', '1:1', '9:16', '4:3'].includes(canvas)) throw new Error('svrouter: unsupported Reactor canvas aspect ratio.')
		if (params.seed !== undefined && !Number.isSafeInteger(Number(params.seed))) throw new Error('svrouter: Reactor seed must be an integer.')
		// HTTPS references are fetched by the official SDK worker. Upload local data
		// through the same public relay as image jobs, without forwarding gateway auth.
		const refs = await Promise.all(images.map(image => prepareMedia(image, true)))
		const audioRefs = await Promise.all(audios.map(audio => prepareMedia(audio, true)))
		const metadata: Record<string, unknown> = { seconds, canvas }
		if (refs.length) metadata.reference_images = refs
		if (audioRefs.length) metadata.reference_audios = audioRefs
		if (mode === 'first-frame' || mode === 'first-last-frame') metadata.first_frame_image = refs[0]
		if (mode === 'first-last-frame') metadata.last_frame_image = refs[1]
		if (params.seed !== undefined) metadata.seed = Number(params.seed)
		const task = await this.request('/videos', { model: stringParam(params.modelId, 'sv-fast-h3-omni'), prompt, metadata })
		if (task.status === 'failed') throw new Error(`svrouter: video task failed — ${errorMessage(task.error)}`)
		const taskId = stringParam(task.id ?? task.task_id, '')
		if (!taskId) throw new Error('svrouter: video task response has no task id.')
		return { done: false, taskId }
	}

	async checkStatus(taskId: string): Promise<GenerateVideoResult> {
		const path = `/videos/${encodeURIComponent(taskId)}`
		const task = await this.request(path)
		if (task.status === 'completed') {
			// Derive the authenticated gateway endpoint locally. Upstream metadata URLs
			// must never receive the user's gateway token.
			return { done: true, filePath: await this.download(`${this.baseUrl}${path}/content`, 'mp4', true) }
		}
		if (task.status === 'failed' || task.status === 'cancelled') throw new Error(`svrouter: video task failed — ${errorMessage(task.error)}`)
		if (!['queued', 'in_progress'].includes(stringParam(task.status, ''))) throw new Error('svrouter: invalid video task status.')
		return { done: false, taskId }
	}
}
