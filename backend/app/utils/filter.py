def clean_name(name):
    # Ràng buộc độ dài: tối đa 15 ký tự
    if len(name) > 15:
        name = name[:12] + "..."
    # Bộ lọc từ ngữ nhạy cảm (profanity filter)
    bad_words = ["dm", "vcl", "cl", "cac", "lon", "fuck", "shit"]
    words = name.split()
    cleaned = []
    for w in words:
        if w.lower() in bad_words:
            cleaned.append("***")
        else:
            cleaned.append(w)
    return " ".join(cleaned)
