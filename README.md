# Gemini TTS 批量语音生成

使用 Google Gemini TTS 为 22 条语音助手应答短语生成音频，输出原始 PCM 格式（24 kHz / 16-bit / 单声道）。

- **模型**：`gemini-3.1-flash-tts-preview`（Vertex AI global 端点）
- **音色**：`Achernar`
- **认证**：gcloud 应用默认凭据（ADC，`authorized_user` + `cloud-platform` scope），无 API key
- **生成日期**：2026-09-16，22/22 全部成功，总时长约 30.9 秒

## 目录结构

```
GCP/
├── tts_gen.mjs          # 生成脚本（Node ≥ 18，无第三方依赖）
├── pcm_out/             # 输出目录
│   ├── 01-*.pcm ... 22-*.pcm
│   └── provenance.json  # 溯源记录（模型、格式、逐文件校验信息）
└── README.md
```

## 短语与文件清单

| # | 文件 | 文本 | 时长 |
|---|------|------|------|
| 01 | `01-please-speak.pcm` | Please speak | 1.72s |
| 02 | `02-i-m-here.pcm` | I'm here | 1.36s |
| 03 | `03-hello.pcm` | Hello | 1.12s |
| 04 | `04-please-instruct.pcm` | Please instruct | 1.60s |
| 05 | `05-good-morning.pcm` | Good morning | 1.48s |
| 06 | `06-morning.pcm` | Morning | 1.28s |
| 07 | `07-hey-there.pcm` | Hey there | 1.08s |
| 08 | `08-good-day.pcm` | Good day | 1.08s |
| 09 | `09-here-i-am.pcm` | Here I am | 1.64s |
| 10 | `10-hi.pcm` | Hi | 1.08s |
| 11 | `11-nice-to-see-you-again.pcm` | Nice to see you again | 1.84s |
| 12 | `12-good-noon.pcm` | Good noon | 1.56s |
| 13 | `13-good-afternoon.pcm` | Good afternoon | 1.48s |
| 14 | `14-hello-there.pcm` | Hello there | 1.48s |
| 15 | `15-yes.pcm` | Yes | 1.44s |
| 16 | `16-i-m-listening.pcm` | I'm listening | 1.48s |
| 17 | `17-good-evening.pcm` | Good evening | 1.36s |
| 18 | `18-here.pcm` | Here | 1.00s |
| 19 | `19-coming.pcm` | Coming | 1.04s |
| 20 | `20-please-talk.pcm` | Please talk | 1.60s |
| 21 | `21-please-speak.pcm` | Please speak（重复条目，独立 take） | 1.80s |
| 22 | `22-good-noon.pcm` | Good noon（重复条目，独立 take） | 1.40s |

## 音频格式与播放

输出为**无文件头的裸 PCM**：24000 Hz、16-bit 有符号小端（s16le）、单声道。

```bash
# 播放
ffplay -f s16le -ar 24000 -ac 1 pcm_out/01-please-speak.pcm

# 转成 WAV（如需容器格式）
ffmpeg -f s16le -ar 24000 -ac 1 -i pcm_out/01-please-speak.pcm 01-please-speak.wav
```

## 重新生成

```bash
node tts_gen.mjs          # 全量 22 条
LIMIT=3 node tts_gen.mjs  # 冒烟测试：仅前 3 条
ONLY=5 node tts_gen.mjs   # 仅重新生成第 5 条
```

修改短语列表：编辑 `tts_gen.mjs` 中的 `PHRASES` 数组；换音色改 `VOICE` 常量。

依赖与前置条件：

- Node ≥ 18（使用内置 fetch，无需 `npm install`）。
- 本机已通过 `gcloud auth application-default login` 登录（凭据位于 `%APPDATA%\gcloud\application_default_credentials.json`，脚本只在内存中使用，不落盘、不打印）。
- 需要 Astrill 处于 Tunnel/OpenWeb 可用状态（Google API 无法直连）。可用 `recover-network-with-astrill` 技能的状态脚本探测。

## 技术要点

- **端点选择**：`generativelanguage.googleapis.com`（消费级 Gemini API）拒收 ADC 令牌的 `cloud-platform` scope（要求专用 generative-language scope），因此走 **Vertex AI** 端点：
  `https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models/{model}:generateContent`
- **模型名**：正确的 ID 是 `gemini-3.1-flash-tts-preview`；`gemini-3.1-flash-preview-tts` 不存在（404 已验证）。
- **请求格式**：Vertex 要求 `contents[].role` 必须为 `"user"`，否则报 "Please use a valid role"。
- **响应格式**：`candidates[0].content.parts[].inlineData`，MIME 为 `audio/l16; rate=24000; channels=1`，base64 解码即得 PCM 裸数据。

## 校验记录（2026-09-16）

- 逐文件检查了时长、首尾静音、峰值与削波：全部时长 1.0–1.84 秒，无削波，特征一致。
- 01 号第一次生成时模型出现复读（15.7 秒、5 段语音爆发），已用 `ONLY=1` 重新生成，现为 1.72 秒。**复读属于 TTS 偶发问题**，重新生成同一序号即可。
- 详见 `pcm_out/provenance.json`。
