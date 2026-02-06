import datetime
from datetime import timedelta

# --- Configuration ---
START_DATE = datetime.date(2026, 1, 1)
END_DATE = datetime.date(2026, 3, 31)
FILENAME = "ThaiAstrology_2026_Q1_Detailed.ics"

# --- Astrological Data ---
# ลัคนา: กันย์ (Virgo)
# ภพที่ให้คุณ (2026): พฤษภ (9/ศุภะ), มังกร (5/ปุตตะ), มิถุน (10/กัมมะ-พฤหัส)
# ภพที่ให้โทษ (2026): มีน (7/ปัตนิ-เสาร์เล็ง)

def get_moon_sign(current_date):
    """
    คำนวณราศีดวงจันทร์อย่างง่าย (อ้างอิง Jan 1, 2026 ~ Gemini)
    Cycle ~2.25 วัน/ราศี
    """
    base_date = datetime.date(2026, 1, 1)
    base_sign = 2 # Gemini
    days_diff = (current_date - base_date).days
    sign_idx = (base_sign + (days_diff / 2.25)) % 12
    return int(sign_idx)

def get_moon_prediction(moon_sign_idx):
    # 0=Aries, 1=Taurus, ... 5=Virgo, ... 11=Pisces
    if moon_sign_idx in [1, 9]: # Taurus, Capricorn (ธาตุดิน-ตรีโกณ)
        return "🌕 วันดี: จันทร์ตรีโกณลัคน์ (โอกาสทางการเงิน/ความสำเร็จ)"
    elif moon_sign_idx == 2: # Gemini (10-กัมมะ + Jupiter)
        return "📈 วันทำงาน: ดาวพฤหัสหนุนนำ (ติดต่อผู้ใหญ่/วิชาการรุ่ง)"
    elif moon_sign_idx == 11: # Pisces (7-เล็ง + Saturn)
        return "⚠️ วันระวัง: จันทร์เล็งลัคน์เจอเสาร์ (อย่าแตกหัก/ระวังคดี)"
    elif moon_sign_idx == 5: # Virgo (1-ทับลัคน์)
        return "👤 วันโดดเด่น: จันทร์ทับลัคน์ (มีเสน่ห์/มั่นใจ)"
    else:
        return "☁️ วันทั่วไป: เน้นประคองตัวตามยาม"

# --- Ubakong Matrix (0=Sun ... 6=Sat) ---
# Values: 4=Golden, 2=Safe(Green), 1=Delay(Orange), 0=Danger(Red)
# อ้างอิงตำราอุบากองมาตรฐาน
UBAKONG_DAY = {
    6: [0, 1, 2, 4, 0], # Sun
    0: [2, 4, 0, 1, 2], # Mon
    1: [1, 2, 4, 0, 1], # Tue (Modified to match standard chart variation)
    2: [4, 0, 1, 2, 4], # Wed
    3: [0, 1, 2, 4, 0], # Thu
    4: [1, 2, 4, 0, 1], # Fri
    5: [0, 1, 2, 4, 0], # Sat
}
# กลางคืนมักใช้วันถัดไป หรือสูตรเฉพาะ (ในที่นี้ใช้สูตร ยามยตรา)
UBAKONG_NIGHT = {
    6: [2, 4, 0, 1, 2], # Sun Night (Like Mon Day)
    0: [1, 2, 4, 0, 1], # Mon Night
    1: [4, 0, 1, 2, 4], # Tue Night
    2: [0, 1, 2, 4, 0], # Wed Night
    3: [1, 2, 4, 0, 1], # Thu Night
    4: [0, 1, 2, 4, 0], # Fri Night
    5: [2, 4, 0, 1, 2], # Sat Night
}

TIME_SLOTS_DAY = [
    ("06:01", "08:24"), ("08:25", "10:48"), ("10:49", "13:12"),
    ("13:13", "15:36"), ("15:37", "18:00")
]
TIME_SLOTS_NIGHT = [
    ("18:01", "20:24"), ("20:25", "22:48"), ("22:49", "01:12"),
    ("01:13", "03:36"), ("03:37", "06:00")
]

def get_slot_info(score):
    if score == 4:
        return "⭐️⭐️⭐️ ยามทองรุ่ง (Golden)", "เจรจา/การเงิน/ขอพร"
    elif score == 2:
        return "🟢 ยามปลอดภัย (Safe)", "เดินทาง/งานทั่วไป"
    elif score == 1:
        return "🔶 ยามหน่วง (Delay)", "งานรูทีน/รอคอย"
    else: # 0
        return "❌ ยามสูญ (Danger)", "หยุด/พัก/เททิ้ง"

def create_event(uid_prefix, date_obj, start_str, end_str, summary, description):
    # Construct DTSTART/DTEND
    # Handle overflow next day for night times (e.g. 01:13 is next day)
    
    # Parse hours to check if it belongs to 'tomorrow' relative to the date_obj logic
    # In astrology, 'Day' starts at 06:00. 
    # But calendar uses Date. We need to align actual calendar datetime.
    
    # Logic: 
    # If slot is in NIGHT and hour < 6, it is technically "tomorrow" by civil date 
    # but belongs to "tonight" of the astrological day.
    # However, for the ICS to render correctly on the grid, we must use accurate Civil Datetime.
    
    d_start = datetime.datetime.strptime(start_str, "%H:%M")
    d_end = datetime.datetime.strptime(end_str, "%H:%M")
    
    start_dt = datetime.datetime.combine(date_obj, d_start.time())
    end_dt = datetime.datetime.combine(date_obj, d_end.time())
    
    # Correction for Night slots crossing midnight
    # Slots: 18-20, 20-22, 22-01(cross), 01-03(next), 03-06(next)
    
    # Specific fix for the sequence
    # Case 1: 22:49 - 01:12
    if start_str.startswith("22") and end_str.startswith("01"):
        end_dt += timedelta(days=1)
    # Case 2: 01:13, 03:37 -> These actually belong to the "Next Civil Day" morning
    # But in the loop we are processing "Astrological Day X".
    # So we must add +1 day to these dates.
    elif start_str.startswith("01") or start_str.startswith("03"):
        start_dt += timedelta(days=1)
        end_dt += timedelta(days=1)

    dt_start_fmt = start_dt.strftime('%Y%m%dT%H%M00')
    dt_end_fmt = end_dt.strftime('%Y%m%dT%H%M00')
    
    return [
        "BEGIN:VEVENT",
        f"UID:{uid_prefix}-{dt_start_fmt}@gemini.astro",
        f"DTSTART;TZID=Asia/Bangkok:{dt_start_fmt}",
        f"DTEND;TZID=Asia/Bangkok:{dt_end_fmt}",
        f"SUMMARY:{summary}",
        f"DESCRIPTION:{description}",
        "TRANSP:OPAQUE", # Show as busy/block
        "END:VEVENT"
    ]

def main():
    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Gemini//Thai Astrology Detailed//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:ยามอุบากอง 2569",
        "X-WR-TIMEZONE:Asia/Bangkok",
    ]
    
    curr = START_DATE
    while curr <= END_DATE:
        weekday = curr.weekday() # 0=Mon, 6=Sun
        # Map to Ubakong Key (Sun=6)
        ub_key = 6 if weekday == 6 else weekday
        
        moon_pred = get_moon_prediction(get_moon_sign(curr))
        
        # 1. Day Slots
        scores_day = UBAKONG_DAY[ub_key]
        for i, (start, end) in enumerate(TIME_SLOTS_DAY):
            title, action = get_slot_info(scores_day[i])
            desc = f"{action}\\n\\n[{moon_pred}]"
            ics_lines.extend(create_event(f"D{curr}", curr, start, end, title, desc))
            
        # 2. Night Slots
        scores_night = UBAKONG_NIGHT[ub_key]
        for i, (start, end) in enumerate(TIME_SLOTS_NIGHT):
            title, action = get_slot_info(scores_night[i])
            desc = f"{action}\\n\\n(ยามกลางคืน)\\n[{moon_pred}]"
            ics_lines.extend(create_event(f"N{curr}", curr, start, end, title, desc))
            
        curr += timedelta(days=1)

    ics_lines.append("END:VCALENDAR")
    
    with open(FILENAME, "w", encoding="utf-8") as f:
        f.write("\n".join(ics_lines))
    print(f"Created {FILENAME} successfully!")

if __name__ == "__main__":
    main()