import os
import sqlite3
from backend.app.config import DATABASE_PATH

# Default 30 questions from frontend/questions.js to seed the database
DEFAULT_QUESTIONS = [
    {
        "question": "Đặc điểm lớn nhất của thời kỳ quá độ lên chủ nghĩa xã hội ở Việt Nam theo Hồ Chí Minh là gì?",
        "options": [
            "Có nền kinh tế công nghiệp hiện đại ngay từ đầu.",
            "Từ một nước nông nghiệp lạc hậu tiến thẳng lên CNXH, không kinh qua giai đoạn phát triển tư bản chủ nghĩa.",
            "Có sự giúp đỡ tuyệt đối và toàn diện từ các nước xã hội chủ nghĩa anh em.",
            "Xây dựng CNXH trong điều kiện đất nước đã hoàn toàn thống nhất và hòa bình."
        ],
        "answer": 1
    },
    {
        "question": "Theo Hồ Chí Minh, thực chất của thời kỳ quá độ lên CNXH ở nước ta là quá trình gì?",
        "options": [
            "Cải biến nền sản xuất lạc hậu thành nền sản xuất hiện đại.",
            "Xóa bỏ ngay lập tức mọi hình thức sở hữu tư nhân về tư liệu sản xuất.",
            "Tập trung toàn lực vào việc xuất khẩu nông sản để tích lũy vốn.",
            "Xây dựng hệ thống chính trị dựa trên sự điều khiển của trí tuệ nhân tạo."
        ],
        "answer": 0
    },
    {
        "question": "\"Sợi chỉ đỏ\" xuyên suốt toàn bộ tư tưởng Hồ Chí Minh và con đường cách mạng Việt Nam là gì?",
        "options": [
            "Giải phóng dân tộc gắn liền với phát triển kinh tế thị trường.",
            "Độc lập dân tộc gắn liền với chủ nghĩa xã hội.",
            "Kết hợp sức mạnh dân tộc với sức mạnh của các cường quốc.",
            "Đấu tranh giai cấp để xóa bỏ nghèo nàn và lạc hậu."
        ],
        "answer": 1
    },
    {
        "question": "Tại sao Hồ Chí Minh cho rằng thời kỳ quá độ là cuộc biến đổi sâu sắc nhất, khó khăn nhất và phức tạp nhất?",
        "options": [
            "Vì chúng ta thiếu vốn và công nghệ hiện đại.",
            "Vì các thế lực thù địch luôn tìm cách phá hoại công cuộc xây dựng.",
            "Vì phải thay đổi triệt để nếp sống, thói quen và thành kiến gốc rễ hàng ngàn năm.",
            "Vì nhân dân chưa hiểu rõ về mục tiêu của chủ nghĩa xã hội."
        ],
        "answer": 2
    },
    {
        "question": "Hồ Chí Minh khẳng định: “Nếu nước độc lập mà dân không hưởng hạnh phúc tự do, thì độc lập cũng...”",
        "options": [
            "Chỉ là hình thức bên ngoài.",
            "Cần phải xem xét lại con đường đi.",
            "Chẳng có nghĩa lý gì.",
            "Không thể bền vững lâu dài."
        ],
        "answer": 2
    },
    {
        "question": "Trong thời kỳ quá độ, Hồ Chí Minh xác định nhiệm vụ trọng tâm nhất về kinh tế là gì?",
        "options": [
            "Xây dựng nền tảng vật chất và kỹ thuật của chủ nghĩa xã hội.",
            "Ưu tiên phát triển các ngành dịch vụ và du lịch.",
            "Mở cửa hoàn toàn thị trường để thu hút vốn đầu tư nước ngoài.",
            "Tập trung vào việc cải tạo tư tưởng cho những người sản xuất nhỏ."
        ],
        "answer": 0
    },
    {
        "question": "Theo Hồ Chí Minh, động lực quan trọng nhất của chủ nghĩa xã hội là gì?",
        "options": [
            "Tiền vốn và tài nguyên thiên nhiên.",
            "Con người, trước hết là nhân dân lao động.",
            "Khoa học kỹ thuật và máy móc hiện đại.",
            "Sự lãnh đạo tuyệt đối của các chuyên gia công nghệ."
        ],
        "answer": 1
    },
    {
        "question": "Điều kiện tiên quyết để bảo đảm độc lập dân tộc gắn liền với CNXH ở Việt Nam là gì?",
        "options": [
            "Có sự ủng hộ từ cộng đồng quốc tế.",
            "Phải bảo đảm vai trò lãnh đạo duy nhất của Đảng Cộng sản.",
            "Phải có nền kinh tế phát triển ngang tầm thế giới.",
            "Phải thực hiện chính sách ngoại giao đa phương hóa."
        ],
        "answer": 1
    },
    {
        "question": "Nguyên tắc \"Dĩ bất biến, ứng vạn biến\" của Hồ Chí Minh hiện nay được vận dụng trong bối cảnh AI như thế nào?",
        "options": [
            "Kiên định giá trị nhân văn (bất biến), linh hoạt sử dụng công nghệ (vạn biến).",
            "Giữ nguyên các phương pháp giảng dạy truyền thống không thay đổi.",
            "Tuyệt đối không thay đổi mục tiêu dù công cụ công nghệ có thay đổi.",
            "Chạy theo mọi xu hướng công nghệ mới nhất để không bị bỏ lại phía sau."
        ],
        "answer": 0
    },
    {
        "question": "Theo giáo trình, chủ nghĩa xã hội có khả năng bảo vệ độc lập dân tộc vững chắc vì:",
        "options": [
            "It giúp chúng ta có vũ khí hiện đại nhất thế giới.",
            "It tạo ra sức mạnh tự thân về kinh tế, chính trị, văn hóa, quốc phòng.",
            "It nhận được sự bảo trợ quân sự từ các nước lớn.",
            "It xóa bỏ hoàn toàn mọi mâu thuẫn giữa các dân tộc trên thế giới."
        ],
        "answer": 1
    },
    {
        "question": "Hồ Chí Minh quan niệm CNXH là một xã hội do ai làm chủ?",
        "options": [
            "Tầng lớp trí thức và chuyên gia.",
            "Nhà nước và các tổ chức chính trị.",
            "Nhân dân lao động.",
            "Các tập đoàn kinh tế nhà nước."
        ],
        "answer": 2
    },
    {
        "question": "\"Bẫy định hướng\" trong thời đại số mà chúng ta cần tránh là gì?",
        "options": [
            "Không biết cách sử dụng các ứng dụng AI.",
            "Nhầm lẫn giữa công cụ (AI, tiền bạc) và mục tiêu (hạnh phúc, tự do).",
            "Chỉ tập trung vào việc học ngoại ngữ mà quên học công nghệ.",
            "Quá tin tưởng vào các thông tin trên mạng xã hội."
        ],
        "answer": 1
    },
    {
        "question": "Theo Hồ Chí Minh, muốn xây dựng chủ nghĩa xã hội, trước hết cần có cái gì?",
        "options": [
            "Những con người xã hội chủ nghĩa.",
            "Một nguồn vốn đầu tư khổng lồ.",
            "Hệ thống luật pháp chặt chẽ và nghiêm khắc.",
            "Các khu công nghiệp hiện đại."
        ],
        "answer": 0
    },
    {
        "question": "Một trong những đặc trưng của CNXH về mặt chính trị là gì?",
        "options": [
            "Mọi quyền lực thuộc về các chuyên gia kỹ thuật.",
            "Xã hội có chế độ dân chủ, quyền lực thuộc về nhân dân.",
            "Nhà nước quản lý mọi hoạt động riêng tư của công dân bằng AI.",
            "Xóa bỏ hoàn toàn các tổ chức đoàn thể chính trị - xã hội."
        ],
        "answer": 1
    },
    {
        "question": "Hồ Chí Minh nhắc nhở việc học tập kinh nghiệm các nước anh em trong xây dựng CNXH phải như thế nào?",
        "options": [
            "Phải rập khuôn máy móc để đảm bảo tính thống nhất.",
            "Chỉ học tập những gì dễ thực hiện nhất.",
            "Học tập nhưng không được áp dụng máy móc, phải vận dụng sáng tạo.",
            "Không cần học tập vì hoàn cảnh Việt Nam là duy nhất."
        ],
        "answer": 2
    },
    {
        "question": "Trong thời kỳ quá độ, loại giặc nào được Hồ Chí Minh gọi là \"giặc nội xâm\"?",
        "options": [
            "Những người có tư tưởng thân phương Tây.",
            "Tham ô, lãng phí và bệnh quan liêu.",
            "Những người lười lao động trong các hợp tác xã.",
            "Các thành phần kinh tế tư nhân còn tồn tại."
        ],
        "answer": 1
    },
    {
        "question": "Để giữ vững độc lập trong hội nhập, chúng ta cần kết hợp sức mạnh nào?",
        "options": [
            "Sức mạnh dân tộc và sức mạnh thời đại.",
            "Sức mạnh quân sự và sức mạnh tài chính cá nhân.",
            "Sức mạnh của công nghệ AI và tài nguyên đất nước.",
            "Sức mạnh của đa số nhân dân và sự hỗ trợ của các tổ chức quốc tế."
        ],
        "answer": 0
    },
    {
        "question": "Mục tiêu cao nhất của CNXH theo Hồ Chí Minh là nâng cao đời sống của ai?",
        "options": [
            "Các cán bộ và đảng viên gương mẫu.",
            "Tất cả mọi tầng lớp nhân dân.",
            "Những người có trình độ chuyên môn cao.",
            "Những người làm việc trong các ngành công nghệ cao."
        ],
        "answer": 1
    },
    {
        "question": "\"Xây\" đi đôi với \"Chống\" trong đạo đức cách mạng thời kỳ quá độ có ý nghĩa gì?",
        "options": [
            "Chỉ tập trung vào việc xử phạt những người vi phạm pháp luật.",
            "Ưu tiên việc xây dựng các công trình kinh tế hơn là giáo dục con người.",
            "Bồi dưỡng những giá trị tốt đẹp đồng thời loại bỏ các thói hư, tật xấu cũ.",
            "Chống lại mọi sự can thiệp của các yếu tố văn hóa bên ngoài."
        ],
        "answer": 2
    },
    {
        "question": "CNXH trong tầm nhìn Hồ Chí Minh hướng tới giải phóng đối tượng nào?",
        "options": [
            "Giải phóng dân tộc.",
            "Giải phóng giai cấp.",
            "Giải phóng xã hội.",
            "Cả ba phương án trên đều đúng."
        ],
        "answer": 3
    },
    {
        "question": "Đâu là \"Kim chỉ nam\" để cá nhân không lạc lối trước làn sóng công nghệ?",
        "options": [
            "Tư tưởng Hồ Chí Minh về các giá trị nhân văn bền vững.",
            "Các hướng dẫn sử dụng công cụ của các tập đoàn công nghệ lớn.",
            "Sự định hướng của các thuật toán dự báo nghề nghiệp.",
            "Việc chạy theo những kỹ năng có thu nhập cao nhất hiện nay."
        ],
        "answer": 0
    },
    {
        "question": "Trong CNXH, văn hóa đóng vai trò là:",
        "options": [
            "Mục tiêu và động lực của sự nghiệp cách mạng.",
            "Một lĩnh vực giải trí sau giờ lao động sản xuất.",
            "Công cụ để quảng bá hình ảnh quốc gia ra thế giới.",
            "Yếu tố thứ yếu so với phát triển kinh tế."
        ],
        "answer": 0
    },
    {
        "question": "Việc phát huy dân chủ trong giai đoạn hiện nay cần thực hiện phương châm nào?",
        "options": [
            "Dân làm, dân chịu trách nhiệm trước pháp luật.",
            "Dân biết, dân bàn, dân làm, dân kiểm tra.",
            "Nhà nước làm thay cho dân để đảm bảo tiến độ.",
            "Chỉ trưng cầu ý kiến dân đối với các vấn đề kinh tế."
        ],
        "answer": 1
    },
    {
        "question": "Để chuẩn bị cho CNXH, Hồ Chí Minh nhấn mạnh việc giáo dục thanh niên phải có cả:",
        "options": [
            "Đức và Tài.",
            "Sức khỏe và Ngoại ngữ.",
            "Kỹ năng AI và Tư duy phản biện.",
            "Kinh nghiệm thực tế và Bằng cấp quốc tế."
        ],
        "answer": 0
    },
    {
        "question": "Tại sao nói CNXH là con đường duy nhất để giải phóng dân tộc triệt để?",
        "options": [
            "Vì nó giúp dân tộc ta trở nên giàu có nhất thế giới.",
            "Vì nó xóa bỏ tận gốc sự áp bức, bóc lột của người đối với người.",
            "Vì nó đảm bảo mọi người dân đều có máy tính sử dụng.",
            "Vì nó giúp chúng ta có quan hệ tốt với tất cả các cường quốc."
        ],
        "answer": 1
    },
    {
        "question": "Nhiệm vụ văn hóa trong thời kỳ quá độ được Hồ Chí Minh xác định là:",
        "options": [
            "Xóa bỏ hoàn toàn các tôn giáo và tín ngưỡng truyền thống.",
            "Triệt để tẩy trừ các di tích thực dân và ảnh hưởng nô dịch.",
            "Chỉ tập trung vào việc phổ cập các kiến thức về công nghệ số.",
            "Giữ nguyên mọi tập tục cũ để bảo tồn bản sắc văn hóa."
        ],
        "answer": 1
    },
    {
        "question": "Theo Hồ Chí Minh, CNXH có nền kinh tế phát triển cao dựa trên:",
        "options": [
            "Lực lượng sản xuất hiện đại và chế độ công hữu về tư liệu sản xuất.",
            "Việc tư hữu hóa toàn bộ các doanh nghiệp nhà nước.",
            "Sự phát triển tự phát của các thành phần kinh tế tư nhân.",
            "Chỉ tập trung vào các ngành thủ công nghiệp truyền thống."
        ],
        "answer": 0
    },
    {
        "question": "\"Tâm bất biến giữa dòng đời vạn biến\" trong thời đại AI có nghĩa là:",
        "options": [
            "Không chấp nhận sự thay đổi của công nghệ hiện đại.",
            "Giữ vững đạo đức, lý tưởng giữa sự thay đổi của công cụ và kỹ năng.",
            "Ngừng việc học tập để giữ cho tâm hồn được bình yên.",
            "Chỉ tin tưởng vào những kinh nghiệm đã có từ quá khứ."
        ],
        "answer": 1
    },
    {
        "question": "Mục tiêu chung của độc lập dân tộc và CNXH đều là:",
        "options": [
            "Mang lại tự do, ấm no và hạnh phúc cho con người.",
            "Trở thành một cường quốc quân sự trong khu vực.",
            "Phát triển công nghệ AI vượt qua các nước tư bản.",
            "Xây dựng một xã hội chỉ có sự đồng nhất về tư tưởng."
        ],
        "answer": 0
    },
    {
        "question": "Việc vận dụng tư tưởng Hồ Chí Minh hiện nay đòi hỏi chúng ta phải chống lại biểu hiện nào?",
        "options": [
            "Sự suy thoái về tư tưởng chính trị và đạo đức, lối sống.",
            "Chủ nghĩa cá nhân và thói quan liêu, hách dịch nhân dân.",
            "Sự thờ ơ với các vấn đề vận mệnh của đất nước.",
            "Tất cả các phương án trên."
        ],
        "answer": 3
    }
]

def get_db_connection():
    # Ensure folder of DATABASE_PATH exists
    db_dir = os.path.dirname(DATABASE_PATH)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Read schema.sql
    schema_path = os.path.join(os.path.dirname(__file__), 'schema.sql')
    with open(schema_path, 'r', encoding='utf-8') as f:
        schema_sql = f.read()
        
    cursor.executescript(schema_sql)
    conn.commit()
    
    # Check if questions table is empty, if so, seed questions
    cursor.execute("SELECT COUNT(*) FROM questions")
    count = cursor.fetchone()[0]
    if count == 0:
        print("Seeding default quiz questions into SQLite...")
        for q in DEFAULT_QUESTIONS:
            cursor.execute(
                "INSERT INTO questions (question, option_0, option_1, option_2, option_3, answer) VALUES (?, ?, ?, ?, ?, ?)",
                (q["question"], q["options"][0], q["options"][1], q["options"][2], q["options"][3], q["answer"])
            )
        conn.commit()
        print("Questions seeded successfully.")
        
    conn.close()

def get_all_questions():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, question, option_0, option_1, option_2, option_3, answer FROM questions")
    rows = cursor.fetchall()
    conn.close()
    
    questions = []
    for r in rows:
        questions.append({
            "id": r["id"],
            "question": r["question"],
            "options": [r["option_0"], r["option_1"], r["option_2"], r["option_3"]],
            "answer": r["answer"]
        })
    return questions

def save_leaderboard_record(name, color, rank, score, race_time):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO leaderboard (name, color, rank, score, race_time) VALUES (?, ?, ?, ?, ?)",
        (name, color, rank, score, race_time)
    )
    conn.commit()
    conn.close()
    print(f"Saved leaderboard record for {name} (Rank: {rank}, Score: {score}, Time: {race_time}s)")

def get_top_leaderboard(limit=15):
    conn = get_db_connection()
    cursor = conn.cursor()
    # Query sorted by rank, then race_time (ascending), score (descending)
    cursor.execute(
        "SELECT name, color, rank, score, race_time, created_at FROM leaderboard ORDER BY rank ASC, race_time ASC, score DESC LIMIT ?",
        (limit,)
    )
    rows = cursor.fetchall()
    conn.close()
    
    leaderboard = []
    for r in rows:
        leaderboard.append({
            "name": r["name"],
            "color": r["color"],
            "rank": r["rank"],
            "score": r["score"],
            "race_time": round(r["race_time"], 2),
            "created_at": r["created_at"]
        })
    return leaderboard
