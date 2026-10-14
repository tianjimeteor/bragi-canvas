# Bragi Canvas

Bragi Canvas turns Obsidian Canvas into a node-based AI generation workspace. It uses selected canvas nodes and incoming edges as prompts and references, runs the model you choose, then writes the generated output back to the canvas as connected nodes.

## Features

- Generate images, videos, text, speech, music, and sound effects from selected canvas nodes.
- Use incoming canvas edges as prompt text and reference inputs.
- Display upstream image, text, and audio references directly on canvas nodes.
- Batch-generate outputs from one prompt.
- Arrange nodes, duplicate connected workflows, split images into tiles, pin generated media, and download outputs.
- Import and export portable `.bragi` canvas workflow packages.
- Optionally expose the active canvas through a local MCP server for agent workflows and automation.

## Requirements

- Obsidian desktop app 1.8.7 or newer.
- Obsidian UI language set to English or English (GB). Bragi Canvas relies on Obsidian's English canvas labels for its toolbar hooks and will not load in other UI languages.
- At least one configured AI provider key for the generation type you want to use.

Bragi Canvas is desktop-only because it uses Obsidian desktop APIs and local file operations.

## Install

After Bragi Canvas is listed in the Obsidian Community Plugins browser:

1. Open Obsidian settings.
2. Go to Community plugins.
3. Search for "Bragi Canvas".
4. Install and enable the plugin.

For beta testing before community approval, install the latest GitHub release with BRAT:

1. Install the BRAT plugin.
2. Run "BRAT: Add a beta plugin for testing".
3. Use `https://github.com/nextbound/bragi-canvas`.
4. Enable Bragi Canvas after BRAT installs it.

You can also manually copy `manifest.json`, `main.js`, and `styles.css` from the latest release into:

```text
<vault>/.obsidian/plugins/bragi-canvas/
```

## Use

1. Open a `.canvas` file.
2. Select a text node or markdown file node.
3. Choose image, video, text, or audio generation from the floating canvas toolbar.
4. Select a model and parameters in the generation bar.
5. Run the generation. Bragi Canvas creates the output node near the source node and connects it back to the source.

Incoming directed edges are treated as upstream references. Text nodes contribute prompt text, image nodes become image references, video nodes can be used for supported video workflows and Gemini text understanding, and audio or PDF nodes can be used by multimodal text models such as Gemini 3.5 Flash.

## MCP server

The MCP server is disabled by default. When enabled in settings, it listens on `127.0.0.1` and exposes canvas operations to local MCP clients. You can configure the port and an optional access token. If a token is set, clients must send `Authorization: Bearer <token>` on every request.

Use the MCP server only for trusted local clients that you want to let read or modify the active Obsidian canvas.

## Providers

Bragi Canvas supports multiple provider integrations, including OpenAI, Anthropic, AWS Bedrock, Google Gemini (Gemini, Imagen, and Veo), Volcengine, BytePlus, Kling, fal.ai, ElevenLabs, MiniMax, Legnext, TokenRouter (`https://api.tokenrouter.com/v1`), APIMart, svrouter (configurable gateway), xAI, and Luma. Availability depends on the models and credentials configured in plugin settings.

Provider credentials are stored by Obsidian in this plugin's local settings data. They are used only to make the provider requests selected by the user.

No provider API keys are bundled with the plugin or included in release assets.

## Network and data disclosure

Bragi Canvas sends prompts and selected upstream reference files to the AI providers configured by the user when a generation is run. Some providers require publicly fetchable reference URLs; for those workflows, Bragi Canvas may upload temporary copies of selected reference files to the built-in Bragi Relay service so the provider can fetch them. Gemini multimodal text generation uses inline image data, and sends upstream video, audio, and PDF refs through Bragi Relay as `fileData.fileUri` inputs. Relay-hosted files are intended as temporary transfer files and are not used for client-side telemetry.

Importing and exporting `.bragi` workflow packages uses the file selected by the user in the desktop file picker. Imported package assets are written only into the vault at `_bragi/assets`; Bragi Canvas does not write plugin update files or modify its installed plugin files at runtime.

The plugin can also run an optional local MCP server on `127.0.0.1` when enabled in settings. If an MCP access token is configured, clients must send the matching bearer token.

Bragi Canvas does not include client-side analytics or telemetry.

## Development

```bash
npm install
npm run dev
npm run build
```

### CSS hot reload (UI tuning)

For UI work you can iterate on styles without rebuilding `main.js` on every save:

1. Point the dev script at your vault plugin folder (once):

```bash
echo "/path/to/vault/.obsidian/plugins/bragi-canvas" > .dev-vault-plugin
```

2. Reload Bragi Canvas once in Obsidian, then run:

```bash
npm run dev:styles
```

3. Edit `src/styles.css` in this repo. Each save syncs to the vault and Obsidian hot-reloads the CSS.

You can also edit the vault's `styles.css` directly; hot reload watches that file too.

When the look is right, copy back into the repo with:

```bash
npm run pull:styles-from-vault
```

`dev:styles` watches `src/styles.css` and copies it into the configured dev vault plugin folder. Release builds do not include any runtime filesystem-based style reload code.

Release tags must be plain semantic versions such as `1.12.4`. Do not prefix tags with `v`.

## Release checklist

1. Update `manifest.json` `version` and `minAppVersion`.
2. Update `package.json` and `package-lock.json` to the same version.
3. Add the version to `versions.json` with the supported `minAppVersion`.
4. Commit the changes.
5. Push a numeric tag that exactly matches `manifest.json` `version`.
6. GitHub Actions builds `main.js` and publishes release assets: `manifest.json`, `main.js`, and `styles.css`.

## License

Bragi Canvas is licensed under the Mozilla Public License 2.0 (`MPL-2.0`). See [LICENSE](LICENSE).

### svrouter gateway

In **Settings → Bragi Canvas → Add a provider**, select **svrouter**, enter your gateway base URL (with or without `/v1`), and enter your **gateway token**. The connection test checks `/v1/models` without starting a generation. Upstream APIMart and Reactor credentials belong on the gateway/worker; do not paste them into the plugin.

- **GPT Image 2.5 Flare** maps to `sv-gpt-image-2.5-flare`; **GPT Image 2.5 Sunburst** maps to `sv-gpt-image-2.5-sunburst`. Both support text prompts, up to 16 connected reference images, aspect ratios, 1K/2K/4K resolution, quality through `max`, transparent backgrounds, moderation, PNG/JPEG/WebP, and JPEG/WebP compression including `0`. Transparent backgrounds require PNG or WebP; JPEG combinations are rejected before uploads.
- Image jobs use `POST /v1/images/tasks` and poll `GET /v1/images/tasks/{id}`. Each network request is short while the generation runs on the gateway. Bragi waits up to 20 minutes; if it times out, the error includes the task ID for inspection on the gateway. Closing Obsidian does not cancel the gateway task.
- Local image references and a programmatic `mask_url` data URL use the existing Bragi temporary public storage relay. The upstream must be able to fetch those URLs. Provider-specific `asset://` IDs and private/local reference URLs are rejected. The gateway token is sent only to your gateway, never to the relay or an image download URL.
- The UI follows the plugin's existing English-only language support. Through MCP/provider options, `size` can specify an exact pixel size (for example `1536x1024`), `resolution` overrides the UI's `imageSize`, and `mask_url` accepts a public HTTP(S) URL or supported image data URL. Mask editing requires an image reference.

**Reactor Fast H3 Omni** maps to `sv-fast-h3-omni` and requires the gateway's official SDK worker bridge. It uses `POST /v1/videos`, the existing task queue polls `GET /v1/videos/{id}`, and completed MP4 files download from authenticated `/v1/videos/{id}/content`. This is a saved video workflow: each job starts an independent SDK session. If a pending task reloads while svrouter credentials are missing or its base URL is invalid, Bragi preserves the snapshot and generating placeholder, then retries resume on Canvas activation after valid credentials are restored.

The video picker offers only the supported output durations (5.875, 8, 10.125, 12.25, and 14.375 seconds) and canvases (16:9, 1:1, 9:16, and 4:3). Native resolution, frame rate, and generated audio are fixed by the model. Connect up to nine image references and three audio references; audio references require at least one image. Reactor audio numbering follows the saved drag order in the Canvas audio strip, so `<Audio 1>` refers to the displayed first audio. First-frame mode pins the first image, and first/last-frame mode pins the first two ordered images, while retaining both as appearance references. Multi-image mode uses the ordered references without pinning endpoints. Video references and continuation between separate jobs are unsupported. References must be public HTTPS URLs; local images use the same temporary relay, and connected audio is uploaded through the existing audio reference flow. Programmatic `seed: 0` is preserved.

Reactor charges by **GPU session wall time**, including generation/export work, rather than the selected output clip duration. Its upstream listed rate is $0.0125 per session second; the final gateway charge also depends on gateway pricing/group configuration. Clip length alone is not a fixed-price estimate. The provider form explains this distinction before configuration.

For a local regression check, run `npm run test:svrouter`. The harness exercises the real plugin generation/resume paths, Canvas ordering helpers, registry, and providers against mocked Obsidian network and vault boundaries, with no live billable API calls.
