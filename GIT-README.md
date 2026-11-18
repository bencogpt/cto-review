# CTO Review – קוד האתר

מאגר גיבוי ומעקב גרסאות לאתר CTO Review (Cloudflare Pages).

- `build.py`, `glossary_lib.py`, `glossary_suggest.py` – בניית האתר הסטטי מתוך `content/*.json` ו-`glossary.json`.
- `assets/` – עיצוב וסקריפטים. `worker/_worker.js` – שער הכניסה (Pages advanced mode).
- `content/` – ארכיון הסקירות היומיות. `sources/sources.json` – מראת מאגר המקורות המנוקה.
- `deploy/` – סקריפטי הכנה, העלאה ובדיקות. הסודות (סיסמאות, מפתח חתימה, טוקנים) נשמרים רק ב-Cloudflare ובמשתני סביבה, ולעולם לא במאגר הזה.
- `CTO-Review-Replica-SPEC.md` – מסמך האפיון לרפליקה.
- `replica/` – זמן הריצה של הרפליקה הלא מקוונת: `assets/import.js` (זיהוי, אימות ומיזוג של קבצים ב-IndexedDB), `assets/replica.js` (רינדור בדפדפן, זהה ל-build.py), `assets/import.css`, `import-demo.html`, קובץ ייצוא לדוגמה, ובדיקות ב-`tests/`. הפירוט בפרק 9 באפיון.
- `deploy/export_test.py` – בדיקה שרק מנהל יכול להוריד את `/admin/export.json` ואת `/admin/update.json`.

## בניית הרפליקה הלא מקוונת

```
python build.py --replica
cd dist
python -m http.server 8000
```

פותחים את http://localhost:8000/. אפשר גם לפתוח את `dist/index.html` ישירות מהדיסק (`file://`). אין כניסה. בתפריט יש «טעינת עדכון».

עדכון יומי:

1. באתר המקוון, בתור מנהל, נכנסים ל-`/admin/` ולוחצים «עדכון יומי מלא (JSON)». יורד הקובץ `cto-review-update-YYYY-MM-DD.json`. אפשר להוריד במקומו את «הורדת JSON» של היום.
2. ברפליקה פותחים «טעינת עדכון», ובוחרים את הקובץ או גוררים אותו.
3. האתר מתעדכן מיד, בלי בנייה מחדש. הנתונים נשמרים בדפדפן.

בפעם הראשונה, או אחרי ניקוי נתוני הדפדפן, טוענים את «ייצוא מלא (JSON)».

בדיקות:

```
node replica/tests/parity.test.js dist
```

מריצים אותה אחרי `--replica`.

```
CTO_DIST=dist node replica/tests/import.test.js
```

מריצים אותה אחרי בנייה רגילה.
