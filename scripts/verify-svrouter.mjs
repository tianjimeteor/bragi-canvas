/* eslint-disable obsidianmd/prefer-active-doc -- This Node regression harness supplies a temporary browser timer boundary, not an Obsidian document. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

// Exercise the real provider/registry/model code. Only Obsidian's network and vault
// boundary is replaced; the temporary asset relay still runs its actual upload code.
let requests = []
let replies = []
const require = createRequire(import.meta.url)
const compiled = await build({
	stdin: { contents: "export { getProvider, getConfiguredProviderIds } from './src/providers/registry'; export { ALL_MODELS, getEnabledModels } from './src/models/index'", resolveDir: process.cwd() },
	bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'], logLevel: 'silent',
})
const exportsModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(id => id === 'obsidian' ? {
	requestUrl: async request => {
		requests.push(request)
		assert.ok(replies.length, `Unexpected request: ${request.url}`)
		const reply = replies.shift()
		if (reply instanceof Error) throw reply
		return reply
	},
} : require(id), exportsModule, exportsModule.exports)
const { getProvider, getConfiguredProviderIds, ALL_MODELS, getEnabledModels } = exportsModule.exports
const settings = { providers: { svrouterBaseUrl: 'https://gateway.example/v1/', svrouterToken: 'gateway-user-token' }, modelPrefs: {} }
const spec = getProvider('svrouter')
assert.ok(spec, 'svrouter must be available in the provider picker')
assert.deepEqual(getConfiguredProviderIds(settings), ['svrouter'])
assert.equal(spec.isConfigured({ providers: { svrouterBaseUrl: 'https://gateway.example', svrouterToken: '' } }), false)
const selected = getEnabledModels('image', [], {}, ['svrouter'])
assert.deepEqual(selected.map(model => model.id), ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])
for (const model of selected) {
	assert.equal(model.supportedProviders.svrouter.apiModelId, `sv-${model.id}`)
	assert.ok(model.modes.includes('image-ref-to-image'))
}
let written = []
let folders = []
const app = { vault: { adapter: {
	exists: async () => false,
	mkdir: async path => folders.push(path),
	writeBinary: async (path, bytes) => written.push({ path, bytes: [...new Uint8Array(bytes)] }),
} } }
const provider = spec.makeImage({ settings, app, outputDir: 'assets' })
const queued = { status: 202, json: { id: 'img/task 1', task_id: 'img/task 1', object: 'image.task', model: 'sv-gpt-image-2.5-flare', status: 'queued', progress: 0, created_at: 1 } }
const completed = { status: 200, json: { ...queued.json, status: 'completed', progress: 100, data: [{ url: 'https://cdn.example/result.webp' }] } }
const imageBytes = { status: 200, headers: { 'content-type': 'image/webp' }, arrayBuffer: new Uint8Array([82, 73, 70, 70]).buffer }
const originalWindow = globalThis.window
globalThis.window = { setTimeout: callback => { queueMicrotask(callback); return 1 } }
function reset(...responses) { requests = []; replies = responses; written = []; folders = [] }
try {
	reset(queued, { status: 200, json: { ...queued.json, status: 'in_progress' } }, completed, imageBytes)
	const result = await provider.generateImage('a quiet lake', { modelId: 'sv-gpt-image-2.5-flare', size: '1536x1024', imageSize: '4K', quality: 'max', output_format: 'webp', output_compression: 0, background: 'transparent', moderation: 'low' })
	assert.deepEqual(JSON.parse(requests[0].body), { model: 'sv-gpt-image-2.5-flare', prompt: 'a quiet lake', n: 1, size: '1536x1024', resolution: '4k', quality: 'max', output_format: 'webp', output_compression: 0, background: 'transparent', moderation: 'low' })
	assert.equal(requests[0].url, 'https://gateway.example/v1/images/tasks')
	assert.equal(requests[1].url, 'https://gateway.example/v1/images/tasks/img%2Ftask%201')
	assert.equal(requests[1].headers.Authorization, 'Bearer gateway-user-token')
	assert.equal(requests[3].headers?.Authorization, undefined, 'Gateway token must not reach the image CDN')
	assert.match(result.filePath, /^assets\/img_.*\.webp$/)
	assert.deepEqual(written[0].bytes, [82, 73, 70, 70])
	assert.deepEqual(folders, ['assets'])

	reset({ status: 200, json: { url: 'https://temp.bragi.now/ref.png' } }, { status: 200, json: { url: 'https://temp.bragi.now/mask.png' } }, queued, completed, imageBytes)
	await provider.generateImage('edit', { modelId: 'sv-gpt-image-2.5-sunburst', refImages: ['data:image/png;base64,AQID', 'https://cdn.example/ref.jpg'], mask_url: 'data:image/png;base64,BAU=', output_format: 'webp' })
	assert.deepEqual([...new Uint8Array(requests[0].body)], [1, 2, 3])
	assert.equal(requests[0].url, 'https://temp.bragi.now/upload?ext=png')
	assert.notEqual(requests[0].headers.Authorization, 'Bearer gateway-user-token')
	assert.deepEqual(JSON.parse(requests[2].body).image_urls, ['https://temp.bragi.now/ref.png', 'https://cdn.example/ref.jpg'])
	assert.equal(JSON.parse(requests[2].body).mask_url, 'https://temp.bragi.now/mask.png')

	for (const ref of ['asset://abc', 'http://localhost/a.png', 'http://127.0.0.1/a.png', 'http://10.0.0.1/a.png', 'http://[::1]/a.png', 'https://user:secret@cdn.example/a.png']) {
		reset()
		await assert.rejects(() => provider.generateImage('bad ref', { refImages: [ref] }), /public.*HTTP|HTTP.*public/i)
		assert.equal(requests.length, 0)
	}
	reset()
	await assert.rejects(() => provider.generateImage('too many', { refImages: Array(17).fill('https://cdn.example/ref.png') }), /16/)
	assert.equal(requests.length, 0)
	reset({ status: 200, json: { url: 'http://localhost/ref.png' } })
	await assert.rejects(() => provider.generateImage('bad relay', { refImages: ['data:image/png;base64,AQID'] }), /public.*HTTP|HTTP.*public/i)
	assert.equal(requests.length, 1, 'Invalid relay URL must not reach gateway')

	reset(queued, { status: 200, json: { ...queued.json, status: 'failed', error: { message: 'upstream unavailable' } } })
	await assert.rejects(() => provider.generateImage('failure'), /upstream unavailable/)
	assert.equal(written.length, 0)
	reset()
	await assert.rejects(() => provider.generateImage('transparent JPEG', { background: 'transparent', output_format: 'jpeg', refImages: ['data:image/png;base64,AQID'] }), /transparen.*PNG|PNG.*transparen/i)
	assert.equal(requests.length, 0, 'Invalid transparency/format choice must fail before relay upload')
	await assert.rejects(() => provider.generateImage('invalid format', { output_format: '../../outside' }), /format/i)
	await assert.rejects(() => provider.generateImage('invalid compression', { output_compression: -1 }), /compression/i)
	await assert.rejects(() => provider.generateImage('mask without image', { mask_url: 'https://cdn.example/mask.png' }), /reference image/i)
	assert.equal(requests.length, 0)
	reset({ status: 401, json: { error: { message: 'Invalid gateway token' } } })
	await assert.rejects(() => provider.generateImage('unauthorized'), /401.*Invalid gateway token/)
	reset({ status: 202, json: { status: 'queued' } })
	await assert.rejects(() => provider.generateImage('malformed'), /task.*id/i)
	reset(queued, { status: 200, json: { status: 'completed', data: [] } })
	await assert.rejects(() => provider.generateImage('missing result'), /image URL/i)
	reset(queued, completed, { status: 403, json: { error: { message: 'expired download' } } })
	await assert.rejects(() => provider.generateImage('expired'), /403/)
	assert.equal(written.length, 0)
	const originalNow = Date.now
	let virtualTime = 1000
	Date.now = () => virtualTime
	globalThis.window = { setTimeout: callback => { virtualTime += 5 * 60 * 1000; queueMicrotask(callback); return 1 } }
	try {
		reset(queued, queued, queued, queued, queued)
		await assert.rejects(() => provider.generateImage('slow task'), /img\/task 1.*timed out.*20 minutes/)
		assert.equal(written.length, 0)
	} finally {
		Date.now = originalNow
		globalThis.window = { setTimeout: callback => { queueMicrotask(callback); return 1 } }
	}
	reset({ status: 200, json: { object: 'list', data: [] } })
	assert.equal((await spec.testConnection({ svrouterBaseUrl: 'https://gateway.example/', svrouterToken: 'gateway-user-token' })).ok, true)
	assert.equal(requests[0].url, 'https://gateway.example/v1/models')
	assert.equal(requests[0].method, 'GET')
	reset()
	assert.equal((await spec.testConnection({ svrouterBaseUrl: 'https://user:secret@gateway.example', svrouterToken: 'gateway-user-token' })).ok, false)
	assert.equal(requests.length, 0)
	const videoModel = ALL_MODELS.find(model => model.id === 'reactor-fast-h3-omni')
	assert.ok(videoModel, 'Reactor Fast H3 Omni must be available with svrouter')
	assert.equal(videoModel.supportedProviders.svrouter.apiModelId, 'sv-fast-h3-omni')
	assert.ok(!videoModel.params.some(param => param.id === 'resolution'), 'Native video resolution is fixed')
	const video = spec.makeVideo({ settings, app, outputDir: 'assets' })
	const videoTask = { status: 202, json: { id: 'video_1', object: 'video', model: 'sv-fast-h3-omni', status: 'queued', progress: 0, created_at: 1 } }
	reset(videoTask)
	assert.deepEqual(await video.generateVideo('The subject speaks', { modelId: 'sv-fast-h3-omni', duration: '5.875', aspectRatio: '9:16', genMode: 'first-last-frame', refImages: ['https://cdn.example/start.png', 'https://cdn.example/end.png'], refAudios: ['https://cdn.example/voice.mp3'], seed: 0 }), { done: false, taskId: 'video_1' })
	assert.equal(requests[0].url, 'https://gateway.example/v1/videos')
	assert.deepEqual(JSON.parse(requests[0].body), { model: 'sv-fast-h3-omni', prompt: 'The subject speaks', metadata: { seconds: 5.875, canvas: '9:16', reference_images: ['https://cdn.example/start.png', 'https://cdn.example/end.png'], reference_audios: ['https://cdn.example/voice.mp3'], first_frame_image: 'https://cdn.example/start.png', last_frame_image: 'https://cdn.example/end.png', seed: 0 } })
	reset({ status: 200, json: { ...videoTask.json, status: 'in_progress', progress: 20 } })
	assert.deepEqual(await video.checkStatus('video_1'), { done: false, taskId: 'video_1' })
	reset({ status: 200, json: { ...videoTask.json, status: 'completed', progress: 100, metadata: { url: 'https://evil.example/steal' } } }, { status: 200, headers: { 'content-type': 'video/mp4' }, arrayBuffer: new Uint8Array([0, 0, 1, 2]).buffer })
	const videoResult = await video.checkStatus('video_1')
	assert.equal(videoResult.done, true)
	assert.match(videoResult.filePath, /^assets\/vid_.*\.mp4$/)
	assert.equal(requests[1].url, 'https://gateway.example/v1/videos/video_1/content', 'Content endpoint must be derived locally; never send gateway token to response URLs')
	assert.equal(requests[1].headers.Authorization, 'Bearer gateway-user-token')
	assert.deepEqual(written[0].bytes, [0, 0, 1, 2])
	reset({ status: 200, json: { url: 'https://temp.bragi.now/image.png' } }, { status: 200, json: { url: 'https://temp.bragi.now/audio.mp3' } }, videoTask)
	await video.generateVideo('local refs', { genMode: 'first-frame', refImages: ['data:image/png;base64,AQID'], refAudios: ['data:audio/mpeg;base64,BAU='] })
	assert.deepEqual(JSON.parse(requests[2].body).metadata, { seconds: 14.375, canvas: '16:9', reference_images: ['https://temp.bragi.now/image.png'], reference_audios: ['https://temp.bragi.now/audio.mp3'], first_frame_image: 'https://temp.bragi.now/image.png' })
	assert.equal(requests[1].url, 'https://temp.bragi.now/upload?ext=mp3')
	assert.notEqual(requests[1].headers.Authorization, 'Bearer gateway-user-token')
	reset(videoTask)
	await video.generateVideo('text scene')
	assert.deepEqual(JSON.parse(requests[0].body).metadata, { seconds: 14.375, canvas: '16:9' })
	for (const [params, pattern] of [
		[{ duration: 6 }, /duration/i],
		[{ aspectRatio: '21:9' }, /canvas|aspect/i],
		[{ refImages: Array(10).fill('https://cdn.example/ref.png') }, /9/],
		[{ refAudios: Array(4).fill('https://cdn.example/ref.mp3') }, /3/],
		[{ refAudios: ['https://cdn.example/ref.mp3'] }, /image/i],
		[{ refVideos: ['https://cdn.example/ref.mp4'] }, /video/i],
		[{ genMode: 'first-frame' }, /image/i],
		[{ genMode: 'first-last-frame', refImages: ['https://cdn.example/ref.png'] }, /2|two/i],
		[{ refImages: ['http://cdn.example/ref.png'] }, /HTTPS/],
		[{ seed: 0.5 }, /seed/i],
		[{ continue_from_clip_id: 'old_session' }, /continuation|parameter/i],
		[{ resolution: '720p' }, /parameter|resolution/i],
	]) {
		reset()
		await assert.rejects(() => video.generateVideo('invalid', params), pattern)
		assert.equal(requests.length, 0, 'Invalid video input must not spend GPU time')
	}
	reset({ status: 200, json: { ...videoTask.json, status: 'failed', error: { message: 'session timed out' } } })
	await assert.rejects(() => video.checkStatus('video_1'), /session timed out/)
	reset({ status: 200, json: { ...videoTask.json, status: 'nonsense' } })
	await assert.rejects(() => video.checkStatus('video_1'), /status/i)
	console.log('svrouter image/video registry, async tasks, uploads, errors, and vault output verified')
} finally {
	globalThis.window = originalWindow
}
