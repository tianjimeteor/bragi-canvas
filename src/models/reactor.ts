import type { ModelConfig } from './types'

export const reactorFastH3Omni: ModelConfig = {
	id: 'reactor-fast-h3-omni',
	name: 'Reactor Fast H3 Omni',
	type: 'video',
	supportedProviders: { svrouter: { apiModelId: 'sv-fast-h3-omni' } },
	modes: ['text-to-video', 'first-frame', 'first-last-frame', 'multi-image-ref'],
	params: [
		{
			id: 'duration', label: 'Output duration', type: 'select', default: '14.375',
			options: ['5.875', '8', '10.125', '12.25', '14.375'].map(value => ({ label: `${value}s`, value })),
		},
		{
			id: 'aspectRatio', label: 'Canvas', type: 'select', default: '16:9',
			options: ['16:9', '1:1', '9:16', '4:3'].map(value => ({ label: value, value })),
		},
	],
}
