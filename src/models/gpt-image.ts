import type { ModelConfig } from './types'

const GPT_IMAGE_RATIOS = [
	{ label: 'Auto', value: 'auto' },
	{ label: '1:1', value: '1:1' },
	{ label: '3:2', value: '3:2' },
	{ label: '2:3', value: '2:3' },
	{ label: '4:3', value: '4:3' },
	{ label: '3:4', value: '3:4' },
	{ label: '5:4', value: '5:4' },
	{ label: '4:5', value: '4:5' },
	{ label: '16:9', value: '16:9' },
	{ label: '9:16', value: '9:16' },
	{ label: '2:1', value: '2:1' },
	{ label: '1:2', value: '1:2' },
	{ label: '3:1', value: '3:1' },
	{ label: '1:3', value: '1:3' },
	{ label: '21:9', value: '21:9' },
	{ label: '9:21', value: '9:21' },
]

export const gptImage: ModelConfig = {
	id: 'gpt-image-2',
	name: 'GPT Image 2',
	type: 'image',
	supportedProviders: {
		openai: { apiModelId: 'gpt-image-2' },
		fal: { apiModelId: 'fal-ai/gpt-image-2' },
		tokenrouter: { apiModelId: 'openai/gpt-5.4-image-2' },
		apimart: { apiModelId: 'gpt-image-2' },
	},
	modes: ['text-to-image'],
	params: [
		{
			id: 'aspectRatio',
			label: 'Aspect Ratio',
			type: 'select',
			options: GPT_IMAGE_RATIOS,
			default: '1:1',
		},
		{
			id: 'imageSize',
			label: 'Size',
			type: 'select',
			options: [
				{ label: 'Auto', value: 'auto' },
				{ label: '1K', value: '1K' },
				{ label: '2K', value: '2K' },
				{ label: '4K', value: '4K' },
			],
			default: '2K',
		},
		{
			id: 'quality',
			label: 'Quality',
			type: 'select',
			options: [
				{ label: 'Auto', value: 'auto' },
				{ label: 'Low', value: 'low' },
				{ label: 'Medium', value: 'medium' },
				{ label: 'High', value: 'high' },
			],
			default: 'auto',
		},
	],
}

/** Dedicated svrouter aliases keep Flare and Sunburst separate in the picker. */
function gptImage25(id: string, name: string): ModelConfig {
	return {
		id, name, type: 'image',
		supportedProviders: { svrouter: { apiModelId: `sv-${id}` } },
		modes: ['text-to-image', 'image-ref-to-image'],
		params: [
			{ id: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: GPT_IMAGE_RATIOS, default: '1:1' },
			{ id: 'imageSize', label: 'Size', type: 'select', options: ['1K', '2K', '4K'].map(value => ({ label: value, value })), default: '2K' },
			{ id: 'quality', label: 'Quality', type: 'select', options: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ label: value, value })), default: 'auto' },
			{ id: 'background', label: 'Background', type: 'select', options: ['auto', 'opaque', 'transparent'].map(value => ({ label: value, value })), default: 'auto' },
			{ id: 'moderation', label: 'Moderation', type: 'select', options: ['auto', 'low'].map(value => ({ label: value, value })), default: 'auto' },
			{ id: 'output_format', label: 'Output format', type: 'select', options: ['png', 'jpeg', 'webp'].map(value => ({ label: value.toUpperCase(), value })), default: 'png' },
			{ id: 'output_compression', label: 'JPEG/WebP compression', type: 'range', min: 0, max: 100, step: 1, default: 100 },
		],
	}
}

export const gptImage25Flare = gptImage25('gpt-image-2.5-flare', 'GPT Image 2.5 Flare')
export const gptImage25Sunburst = gptImage25('gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst')
