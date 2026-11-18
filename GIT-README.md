# CTO Review – קוד האתר

מאגר גיבוי ומעקב גרסאות לאתר CTO Review (Cloudflare Pages).

- `build.py`, `glossary_lib.py`, `glossary_suggest.py` – בניית האתר הסטטי מתוך `content/*.json` ו-`glossary.json`.
- `assets/` – עיצוב וסקריפטים. `worker/_worker.js` – שער הכניסה (Pages advanced mode).
- `content/` – ארכיון הסקירות היומיות. `sources/sources.json` – מראת מאגר המקורות המנוקה.
- `deploy/` – סקריפטי הכנה, העלאה ובדיקות. הסודות (סיסמאות, מפתח חתימה, טוקנים) נשמרים רק ב-Cloudflare ובמשתני סביבה, ולעולם לא במאגר הזה.
- `CTO-Review-Replica-SPEC.md` – מסמך האפיון לרפליקה.
- `replica/` – מימוש הייחוס לטעינת קבצים ברפליקה הלא מקוונת (`assets/import.js`, `assets/import.css`, `import-demo.html`), לפי פרק 9 באפיון. קובץ הייצוא לדוגמה נמצא רק בערכת הרפליקה.
- `deploy/export_test.py` – בדיקה שרק מנהל יכול להוריד את `/admin/export.json`.
