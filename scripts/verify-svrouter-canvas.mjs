/* eslint-disable obsidianmd/prefer-active-doc -- Node test harness with simulated Obsidian boundaries. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

// Run the actual plugin generation/resume methods, edge parser, order helpers,
// relay uploader, and providers. Obsidian UI, network, and vault I/O are external.
const require = createRequire(import.meta.url)
let requests = []
let saved = []
const compiled = await build({
	stdin: { contents: "export { default as BragiCanvas } from './src/main'; export { getOrderedAudios } from './src/audio-refs'; export { getUpstreamInputs } from './src/edge-parser'; export { reactorFastH3Omni } from './src/models/reactor'; export { sweepInterruptedPlaceholders } from './src/canvas-ops'", resolveDir: process.cwd() },
	bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian', 'pannellum/build/pannellum.js'], loader: { '.css': 'text' }, logLevel: 'silent',
})
class Plugin {
	constructor(app) { this.app = app }
	async saveData(data) { saved.push(data) }
}
const obsidian = new Proxy({
	Plugin,
	requestUrl: async request => {
		requests.push(request)
		if (request.url.startsWith('https://temp.bragi.now/upload')) {
			return { status: 200, json: { url: `https://temp.bragi.now/ref_${new Uint8Array(request.body)[0]}` } }
		}
		assert.equal(request.url, 'https://gateway.example/v1/videos')
		return { status: 202, json: { id: 'video_order', object: 'video', model: 'sv-fast-h3-omni', status: 'queued', progress: 0, created_at: 1 } }
	},
}, { get: (target, key) => target[key] || class {} })
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(id => id === 'obsidian' ? obsidian : id === 'pannellum/build/pannellum.js' ? {} : require(id), compiledModule, compiledModule.exports)
const { BragiCanvas, getOrderedAudios, getUpstreamInputs, reactorFastH3Omni, sweepInterruptedPlaceholders } = compiledModule.exports
const readPaths = []
const app = { vault: { adapter: {
	readBinary: async path => { readPaths.push(path); return new Uint8Array([{ 'face.png': 3, 'alice.mp3': 1, 'bob.mp3': 2 }[path]]).buffer },
} }, workspace: { getLeaf: () => ({ view: { file: { path: 'scene.canvas' } } }) } }
const node = { id: 'prompt', getData: () => ({ type: 'text', bragiAudioOrder: ['bob.mp3', 'alice.mp3', 'removed.mp3'] }) }
const fileNode = (id, path) => ({ id, getData: () => ({ type: 'file', file: path }) })
const alice = fileNode('alice', 'alice.mp3')
const bob = fileNode('bob', 'bob.mp3')
const face = fileNode('face', 'face.png')
const edge = source => ({ from: { node: source }, to: { node }, getData: () => ({ toEnd: 'arrow', fromEnd: 'none' }) })
let placeholderData = { type: 'text', bragiGenerating: true }
const placeholder = { id: 'placeholder', getData: () => placeholderData, setData: data => { placeholderData = data } }
const canvas = { getEdgesForNode: () => [edge(alice), edge(bob), edge(alice), edge(face)], nodes: new Map([['prompt', node], ['placeholder', placeholder]]) }
const upstream = getUpstreamInputs(canvas, node)
assert.deepEqual(upstream.audios, ['alice.mp3', 'bob.mp3', 'alice.mp3'])
assert.deepEqual(getOrderedAudios(canvas, node), ['bob.mp3', 'alice.mp3'])
const plugin = new BragiCanvas(app)
plugin.settings = { ...plugin.settings, providers: { ...plugin.settings.providers, svrouterBaseUrl: 'https://gateway.example', svrouterToken: 'gateway-user-token' } }
const liveTasks = []
plugin.taskQueue = { addTask: task => liveTasks.push(task), hasTask: id => liveTasks.some(task => task.snapshot.taskId === id), getSnapshots: () => liveTasks.map(task => task.snapshot) }
await plugin.runSingleGeneration(node, { model: reactorFastH3Omni, activeProvider: 'svrouter', apiModelId: 'sv-fast-h3-omni', mode: 'multi-image-ref', params: { duration: '8' } }, canvas, placeholder, '<Audio 1> is Bob; <Audio 2> is Alice.', upstream, [])
const submission = requests.find(request => request.url.endsWith('/v1/videos'))
assert.ok(submission, 'Canvas generation must submit the video')
assert.deepEqual(JSON.parse(submission.body).metadata.reference_audios, ['https://temp.bragi.now/ref_2', 'https://temp.bragi.now/ref_1'], 'Reference audio numbering must match the drag-reordered Canvas labels')
assert.deepEqual(readPaths.filter(path => path.endsWith('.mp3')), ['bob.mp3', 'alice.mp3'])
assert.equal(liveTasks.length, 1)

// A pending Reactor task must survive absent/invalid credentials and later resume.
liveTasks.length = 0
const snap = { taskId: 'pending_reactor', providerName: 'svrouter', apiModelId: 'sv-fast-h3-omni', modelName: 'Reactor Fast H3 Omni', canvasPath: 'scene.canvas', sourceNodeId: 'prompt', placeholderNodeId: 'placeholder', outputDir: '_bragi/assets', startedAt: 1 }
plugin.pendingTaskSnapshots = [snap]
for (const providers of [
	{ svrouterBaseUrl: '', svrouterToken: '' },
	{ svrouterBaseUrl: 'not a URL', svrouterToken: 'gateway-user-token' },
]) {
	plugin.settings.providers = { ...plugin.settings.providers, ...providers }
	assert.doesNotThrow(() => plugin.resumePendingTasksForCanvas(canvas, 'scene.canvas'))
	assert.deepEqual(plugin.pendingTaskSnapshots, [snap], 'Missing credentials must defer, not drop the snapshot')
	assert.equal(plugin.resumedCanvasPaths.has('scene.canvas'), false, 'Canvas must remain eligible to retry')
	assert.equal(liveTasks.length, 0)
	await plugin.saveSettings()
	assert.deepEqual(saved.at(-1)._pendingTasks, [snap], 'Editing credentials must preserve the deferred task on disk')
	assert.equal(sweepInterruptedPlaceholders(canvas, id => plugin.isTrackedGeneratingPlaceholder(id, 'scene.canvas')), 0, 'Deferred task must not be marked interrupted by the subsequent Canvas sweep')
	assert.equal(placeholderData.bragiGenerating, true)
}
plugin.settings.providers = { ...plugin.settings.providers, svrouterBaseUrl: 'https://gateway.example', svrouterToken: 'gateway-user-token' }
plugin.resumePendingTasksForCanvas(canvas, 'scene.canvas')
assert.equal(liveTasks.length, 1)
assert.equal(liveTasks[0].snapshot.taskId, 'pending_reactor')
assert.equal(typeof liveTasks[0].provider.checkStatus, 'function')
assert.deepEqual(plugin.pendingTaskSnapshots, [])
assert.equal(plugin.resumedCanvasPaths.has('scene.canvas'), true)
plugin.resumePendingTasksForCanvas(canvas, 'scene.canvas')
assert.equal(liveTasks.length, 1, 'Repeated activation must not queue the task twice')
console.log('svrouter Canvas audio ordering and deferred Reactor task resume verified')
