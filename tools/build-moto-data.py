#!/usr/bin/env python3
"""
从摩托车驾考 SQLite 题库生成单文件网页所需的 data.js。

输入题库特点：
- car_type=moto，覆盖摩托车 D/E/F 共用理论题；
- 题干和解析字段使用固定 XOR 密钥编码；
- 答案使用位掩码：16=A、32=B、64=C、128=D；
- 科目一全国通用章节为 207~210，地方题章节不纳入本页面。

输出：
- window.MOTO_D_META：题库版本、题量和数据说明；
- window.MOTO_D_BANK：前端可直接使用的题目数组；
- questions/moto_*.{jpg,png}：从 SQLite 中提取的题目图片。
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_ROOT = PROJECT_ROOT / "outputs" / "kemu1"
IMAGE_ROOT = OUTPUT_ROOT / "questions"
XOR_KEY = b"_jiakaobaodian.com_"

# 摩托车科目一通用题库的四个章节 ID。
# 地方题章节（上海、重庆、山东等）不属于全国通用题库，因此不混入本页面。
MOTO_K1_CHAPTER_IDS = {207, 208, 209, 210}
TYPE_MAP = {0: "judge", 1: "single", 2: "multi"}


def xor_decode(value: bytes | None) -> str:
    """还原题库中的 XOR 文本字段。"""
    if not value:
        return ""
    data = bytes(value)
    return bytes(byte ^ XOR_KEY[index % len(XOR_KEY)] for index, byte in enumerate(data)).decode(
        "utf-8", errors="replace"
    )


def strip_html(value: str) -> str:
    """移除题库中的轻量 HTML，并保留可读换行。"""
    replacements = {
        "<br>": "\n",
        "<br/>": "\n",
        "<br />": "\n",
        "</p>": "\n",
        "&nbsp;": " ",
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
    }
    for source, target in replacements.items():
        value = value.replace(source, target)
    while "<" in value and ">" in value:
        start = value.find("<")
        end = value.find(">", start)
        if end < 0:
            break
        value = value[:start] + value[end + 1 :]
    return "\n".join(line.strip() for line in value.splitlines() if line.strip()).strip()


def mask_to_indexes(mask: int, option_count: int) -> list[int]:
    """把 16/32/64/... 位掩码转换为从 0 开始的答案下标。"""
    indexes = []
    for index in range(8):
        if int(mask or 0) & (16 << index):
            indexes.append(index)
    return [index for index in indexes if index < option_count]


def detect_suffix(content: bytes) -> str:
    """根据文件头判断嵌入图片格式。"""
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if content.startswith(b"GIF8"):
        return ".gif"
    return ".jpg"


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法：python3 tools/build-moto-data.py /path/to/moto.db")

    database_path = Path(sys.argv[1]).expanduser().resolve()
    if not database_path.exists():
        raise SystemExit(f"题库不存在：{database_path}")

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    IMAGE_ROOT.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row

    version_row = connection.execute("SELECT version FROM t_version LIMIT 1").fetchone()
    bank_version = str(version_row["version"]) if version_row else "unknown"

    chapter_titles = {
        int(row["_id"]): str(row["title"] or "")
        for row in connection.execute("SELECT _id, title FROM t_chapter")
    }

    # 同一道题可能关联多个章节；按插入顺序取第一个章节，与题库采集器保持一致。
    first_chapter: dict[int, int] = {}
    for row in connection.execute(
        "SELECT question_id, chapter_id FROM t_chapter_question ORDER BY _id"
    ):
        question_id = int(row["question_id"])
        if question_id not in first_chapter:
            first_chapter[question_id] = int(row["chapter_id"])

    # 媒体表内的图片直接内嵌在 SQLite 中。
    # 先缓存到内存，等确认哪道题进入 D 照科一题库后再落盘，避免复制无关图片。
    media_blobs: dict[str, tuple[bytes, str]] = {}
    for row in connection.execute(
        "SELECT media_key, media_content FROM t_media WHERE media_content IS NOT NULL"
    ):
        media_key = str(row["media_key"] or "")
        content = bytes(row["media_content"] or b"")
        if not media_key or len(content) < 200:
            continue
        safe_key = "".join(char if char.isalnum() or char in "-_" else "_" for char in media_key)
        filename = f"moto_{safe_key}{detect_suffix(content)}"
        media_blobs[media_key] = (content, filename)

    questions = []
    written_media: set[str] = set()
    for row in connection.execute("SELECT * FROM t_question ORDER BY sort, question_id"):
        question_id = int(row["question_id"])
        chapter_id = first_chapter.get(question_id)
        if chapter_id not in MOTO_K1_CHAPTER_IDS:
            continue

        question_text = strip_html(xor_decode(row["question"]))
        options = [
            str(row[f"option_{letter}"] or "").strip()
            for letter in "abcdefgh"
        ]
        options = [option for option in options if option]
        if not question_text or len(options) < 2:
            continue

        answer = mask_to_indexes(int(row["answer"] or 0), len(options))
        if not answer:
            continue

        raw_type = int(row["option_type"] or 0)
        question_type = TYPE_MAP.get(raw_type, "single")

        # 摩托车科目一正式考试只有判断题和单选题，源库中的多选不纳入本页面。
        if question_type == "multi":
            continue

        explanation = strip_html(xor_decode(row["explain"]))
        concise = strip_html(xor_decode(row["concise_explain"]))
        media_key = str(row["media_key"] or "")
        image_path = ""
        if media_key in media_blobs:
            content, filename = media_blobs[media_key]
            if filename not in written_media:
                (IMAGE_ROOT / filename).write_bytes(content)
                written_media.add(filename)
            image_path = f"questions/{filename}"

        questions.append(
            {
                "id": f"moto-{question_id}",
                "sourceIds": [str(question_id)],
                "subject": "moto-d",
                "subjectName": "摩托车 D 照科目一",
                "type": question_type,
                "chapter": chapter_titles.get(chapter_id, "摩托车科目一"),
                "question": question_text,
                "options": options,
                "answer": answer,
                "analysis": explanation or concise,
                "mnemonic": concise if concise != explanation else "",
                "image": image_path,
            }
        )

    # 完全相同的题干与选项只保留一次，避免重复刷题。
    unique_questions = []
    seen = set()
    for question in questions:
        signature = "\0".join([question["question"], *question["options"]])
        if signature in seen:
            continue
        seen.add(signature)
        unique_questions.append(question)

    # 去重时可能移除少量带图题目；同步删除已不再被题库引用的 moto_* 图片。
    used_media = {
        Path(question["image"]).name
        for question in unique_questions
        if question["image"]
    }
    for image_file in IMAGE_ROOT.glob("moto_*"):
        if image_file.name not in used_media:
            image_file.unlink()

    chapters = sorted({question["chapter"] for question in unique_questions})
    media_count = sum(1 for question in unique_questions if question["image"])
    meta = {
        "title": "厦门摩托车 D 照科目一",
        "version": bank_version,
        "exam": "摩托车 D 照科目一",
        "region": "厦门适用",
        "source": "2026 摩托车驾考题库快照（全国通用科一章节）",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "questionCount": len(unique_questions),
        "mediaCount": media_count,
        "chapters": chapters,
    }

    output = "\n".join(
        [
            "/* 自动生成文件，请运行 tools/build-moto-data.py 更新。 */",
            f"window.MOTO_D_META = {json.dumps(meta, ensure_ascii=False)};",
            f"window.MOTO_D_BANK = {json.dumps(unique_questions, ensure_ascii=False)};",
            "",
        ]
    )
    (OUTPUT_ROOT / "data.js").write_text(output, encoding="utf-8")
    print(
        f"已生成摩托车 D 照科目一题库：{len(unique_questions)} 题、"
        f"{media_count} 个媒体文件、{len(chapters)} 个章节，版本 {bank_version}"
    )


if __name__ == "__main__":
    main()
