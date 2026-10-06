# latest_short：API key 与热词增强

本文可独立使用：下方提供完整 Python 代码和热词文件格式，无需下载本仓库。
也可以运行仓库根目录的 `asr_v1_latest_short.py`。需要 Python 3.9 或更新版本，无第三方依赖。
通过同步 REST 接口 `https://speech.googleapis.com/v1/speech:recognize` 调用
`latest_short`；使用 `x-goog-api-key` 请求头，不依赖 gcloud、ADC 或 OAuth token。

## 前置配置

1. 在已启用 Speech-to-Text API、已关联账单账号的 GCP 项目中创建 API key，限制其只允许调用 `speech.googleapis.com`。
2. 将密钥放在 `api_key.txt`，内容只有一行密钥；或通过 `GOOGLE_API_KEY` 环境变量提供。环境变量优先。macOS/Linux 建议设置为 `chmod 600 api_key.txt`，并将它加入自己的 `.gitignore`。本仓库已经忽略此文件。
3. 准备最长 60 秒的 16-bit、单声道 PCM WAV；脚本自动读取 WAV 采样率。

如果原始文件是 Voice Memos 导出的 M4A，可使用已安装的 FFmpeg 转换：

```bash
ffmpeg -i recording.m4a -ac 1 -ar 16000 -c:a pcm_s16le recording.wav
```

## 独立调用：从文件加载热词

在同一个工作目录准备以下文件：

```text
stt_v1.py          # 下方完整代码
api_key.txt        # 你的 API key，或改用 GOOGLE_API_KEY 环境变量
hotwords.txt      # UTF-8 文本，每行一个词或完整短语
recording.wav     # 待识别音频
```

`hotwords.txt` 示例（本次实测仅写第一行 Denza 就已有效）：

```text
Denza
Hi Denza
Hey Denza
```

以下完整代码保存为 `stt_v1.py`。热词按行读取、去除首尾空格和重复项；空行忽略，
以 `#` 开头的行作为注释。每次请求重新读取文件，修改热词后无需重新部署云端资源。
所有相对路径都以运行命令时的工作目录为准。

```python
import argparse
import base64
import json
import os
from pathlib import Path
import urllib.error
import urllib.request
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--language", default="en-US")
    parser.add_argument("--hotwords-file", type=Path)
    parser.add_argument("--boost", type=float, default=10)
    parser.add_argument("--output", type=Path, default=Path("result.json"))
    args = parser.parse_args()
    if not 0 <= args.boost <= 20:
        parser.error("boost must be between 0 and 20")

    key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not key:
        key = Path("api_key.txt").read_text(encoding="utf-8").strip()
    if not key:
        parser.error("API key is empty")

    with wave.open(str(args.audio), "rb") as wav:
        if (wav.getsampwidth() != 2 or wav.getnchannels() != 1
                or wav.getcomptype() != "NONE"):
            parser.error("Expected 16-bit mono PCM WAV")
        rate = wav.getframerate()
        if wav.getnframes() / rate > 60:
            parser.error("Audio must be at most 60 seconds")

    config = {
        "encoding": "LINEAR16",
        "sampleRateHertz": rate,
        "languageCode": args.language,
        "model": "latest_short",
        "enableAutomaticPunctuation": True,
    }
    if args.hotwords_file:
        lines = args.hotwords_file.read_text(encoding="utf-8-sig").splitlines()
        words = list(dict.fromkeys(
            line.strip() for line in lines
            if line.strip() and not line.strip().startswith("#")
        ))
        if words:
            config["adaptation"] = {
                "phraseSets": [{
                    "boost": args.boost,
                    "phrases": [{"value": word} for word in words],
                }]
            }

    body = {
        "config": config,
        "audio": {"content": base64.b64encode(args.audio.read_bytes()).decode("ascii")},
    }
    request = urllib.request.Request(
        "https://speech.googleapis.com/v1/speech:recognize",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, result = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, result = error.code, json.load(error)

    # 保存 Google 的响应；不保存密钥，并遮蔽服务端可能回显的密钥。
    text = json.dumps(result, ensure_ascii=False, indent=2).replace(key, "[REDACTED]")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text + "\n", encoding="utf-8")
    print("HTTP", status)
    if status != 200:
        print(text)
        return 1
    transcripts = [item["alternatives"][0]["transcript"]
                   for item in result.get("results", []) if item.get("alternatives")]
    print(" ".join(transcripts) if transcripts else "No recognition result")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

带热词识别：

```bash
python3 stt_v1.py --audio recording.wav --language en-US \
  --hotwords-file hotwords.txt --boost 10 --output with-hotwords.json
```

同一音频不带热词作为对照：

```bash
python3 stt_v1.py --audio recording.wav --language en-US \
  --output without-hotwords.json
```

`boost` 是识别偏置强度，不是概率、倍率或保证匹配。这里以实测有效的 `10` 起步，
再根据真实易错词和负样本调整。输出可能是 `Hi denza.`，热词不会保证大小写。

## 使用仓库已有脚本

在仓库根目录运行：

```bash
python3 asr_v1_latest_short.py \
  --audio wav_out/01-please-speak.wav \
  --language en-US \
  --hotword "Please speak" \
  --boost 10 \
  --output tmp/latest-short.json
```

对自己的 Denza 录音，将 `--audio` 替换为录音文件，使用 `--hotword Denza --boost 10`。
可重复传入多个热词：`--hotword Denza --hotword "Hi Denza" --hotword "Hey Denza"`。
省略所有 `--hotword` 参数即可测试无热词基线。脚本接受 boost 范围为 0–20。

上述两种调用方式都通过请求体中的 `config.adaptation` 内联传入热词，
无需创建云端 PhraseSet。配置中的相关部分如下：

```json
{
  "adaptation": {
    "phraseSets": [{
      "boost": 10,
      "phrases": [{"value": "Denza"}]
    }]
  }
}
```

仓库脚本输出 JSON 包含请求配置、音频哈希、HTTP 状态、总耗时及原始响应，不包含密钥，
识别文本位于 `response.results[].alternatives[0].transcript`。
独立示例保存的则是 Google 原始响应，识别文本位于 `results[].alternatives[0].transcript`。
HTTP 200 不保证存在识别文本；`results` 可能缺失。仓库脚本的耗时包含网络与建连。
脚本会将输入音频发送给 Google Speech-to-Text，调用按项目计费规则计费。

## 常见问题

- HTTP 400：检查语言、模型、热词结构，以及 WAV 真实采样率是否与配置一致。
- HTTP 403：检查 Speech-to-Text API 是否启用、项目计费状态，以及 key 的 API/IP 限制；以响应中的具体错误原因定位。
- HTTP 200 但没有 `results`：本次没有输出识别文本，不等于网络请求失败；可用同一音频对比热词配置。
- 网络超时：检查当前网络是否能连接 `speech.googleapis.com`。
- 本文是录完整段后的同步转写，不是边录边返回文字的流式识别，也不是专用唤醒词检测器。

## 2026-10-06 实测

英语和法语合成短句的 4 次冒烟请求全部返回 HTTP 200，带热词与不带热词均识别正确。
另用 5 条真人 Hi / Hey Denza 录音，统一转换为 16 kHz PCM WAV，固定 `en-US`，
对比以下三种设置。表中保留原始大小写与标点，未做文本纠错。

| 录音 | 无热词 | Denza，boost=10 | Denza / Hi Denza / Hey Denza，boost=10 |
|---|---|---|---|
| 1 | Hey denza. | Hey denza. | Hey denza. |
| 2 | 无结果 | Hi denza. | Hi denza. |
| 3 | Hey Denzel. | Hey denza. | Hey denza. |
| 4 | Hi denz. | Hi denza. | Hi denza. |
| 5 | Hi Denzel. | Hi denza. | Hi denza. |

忽略大小写与标点，目标词 Denza 命中率由 1/5 提升至 5/5。第 2 条另外两次无热词复测
仍为空，一次 Denza 热词复测成功。18 次真人录音请求全部 HTTP 200。
这里只验证少量正样本上的同步转写，不代表总体准确率、误触发率或流式唤醒效果。
原始真人录音和本机测试输出保留在本地，未随此文档发布。

参考：[V1 语言与模型适配支持表](https://docs.cloud.google.com/speech-to-text/docs/v1/speech-to-text-supported-languages)。
