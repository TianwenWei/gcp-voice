# Gemini TTS 批量语音生成

使用 Google Gemini TTS 为 22 条语音助手应答短语生成音频，输出原始 PCM 格式（24 kHz / 16-bit / 单声道）。

- **模型**：`gemini-3.1-flash-tts-preview`（Vertex AI global 端点）
- **音色**：`Achernar`
- **语气**：车载唤醒应答——温暖、友善、带一点 vocal smile；邀请开口而不是下命令。请求类短语用 `[gently]`，其余用 `[warmly]`。
- **认证**：gcloud 应用默认凭据（ADC，`authorized_user` + `cloud-platform` scope），无 API key
- **生成日期**：2026-09-16（全量重录，修正上版部分条目语气偏硬/像生气），22/22 全部成功，总时长约 29.7 秒

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
| 01 | `01-please-speak.pcm` | Please speak | 1.48s |
| 02 | `02-i-m-here.pcm` | I'm here | 1.20s |
| 03 | `03-hello.pcm` | Hello | 1.16s |
| 04 | `04-please-instruct.pcm` | Please instruct | 1.64s |
| 05 | `05-good-morning.pcm` | Good morning | 1.32s |
| 06 | `06-morning.pcm` | Morning | 1.20s |
| 07 | `07-hey-there.pcm` | Hey there | 1.40s |
| 08 | `08-good-day.pcm` | Good day | 1.32s |
| 09 | `09-here-i-am.pcm` | Here I am | 1.44s |
| 10 | `10-hi.pcm` | Hi | 1.00s |
| 11 | `11-nice-to-see-you-again.pcm` | Nice to see you again | 1.92s |
| 12 | `12-good-noon.pcm` | Good noon | 1.56s |
| 13 | `13-good-afternoon.pcm` | Good afternoon | 1.48s |
| 14 | `14-hello-there.pcm` | Hello there | 1.24s |
| 15 | `15-yes.pcm` | Yes | 1.20s |
| 16 | `16-i-m-listening.pcm` | I'm listening | 1.52s |
| 17 | `17-good-evening.pcm` | Good evening | 1.28s |
| 18 | `18-here.pcm` | Here | 1.04s |
| 19 | `19-coming.pcm` | Coming | 1.16s |
| 20 | `20-please-talk.pcm` | Please talk | 1.36s |
| 21 | `21-please-speak.pcm` | Please speak（重复条目，独立 take） | 1.48s |
| 22 | `22-good-noon.pcm` | Good noon（重复条目，独立 take） | 1.28s |

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

修改短语列表：编辑 `tts_gen.mjs` 中的 `PHRASES` 数组；换音色改 `VOICE` 常量。语气由脚本里的 style prompt 控制，不要只喂光秃短语，否则短句容易被念成命令/生气。

依赖与前置条件：

- Node ≥ 18（使用内置 fetch，无需 `npm install`）。
- 本机已通过 `gcloud auth application-default login` 登录。脚本会按顺序查找 `GOOGLE_APPLICATION_CREDENTIALS`、Windows `%APPDATA%\gcloud\application_default_credentials.json`、macOS `~/.config/gcloud/application_default_credentials.json`；凭据只在内存中使用，不落盘、不打印。
- 需要 Astrill 处于 Tunnel/OpenWeb 可用状态（Google API 无法直连）。可用 `recover-network-with-astrill` 技能的状态脚本探测。

## 技术要点

- **端点选择**：`generativelanguage.googleapis.com`（消费级 Gemini API）拒收 ADC 令牌的 `cloud-platform` scope（要求专用 generative-language scope），因此走 **Vertex AI** 端点：
  `https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models/{model}:generateContent`
- **模型名**：正确的 ID 是 `gemini-3.1-flash-tts-preview`；`gemini-3.1-flash-preview-tts` 不存在（404 已验证）。
- **请求格式**：Vertex 要求 `contents[].role` 必须为 `"user"`，否则报 "Please use a valid role"。
- **响应格式**：`candidates[0].content.parts[].inlineData`，MIME 为 `audio/l16; rate=24000; channels=1`，base64 解码即得 PCM 裸数据。

## 校验记录（2026-09-16 重录）

- 上版部分短句（尤其 Please speak / instruct / talk）没有风格提示，听起来偏硬、像生气。本次全量重录：style prompt + `[gently]`/`[warmly]`，并加时长/复读/削波/音量门限（最多 5 take）。
- 逐文件时长 1.00–1.92 秒，单段语音、无削波；峰值约 10k–20k，避免过轻或过冲。
- Gemini 2.5 Flash 听写 22 条：文本全部匹配，无 angry/stern 标记。07、16 因音量偏离又各重录一次。
- **复读属于 TTS 偶发问题**，重新生成同一序号即可。
- 详见 `pcm_out/provenance.json`。
