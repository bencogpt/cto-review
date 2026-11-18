# דוח ביקורת מול Modern Web Guidance

מסמך זה מתעד ביקורת של קוד אתר CTO Review (הגנרטור `build.py`, `assets/style.css`, `assets/theme.js`, `assets/app.js`, `assets/admin.js`, והפלט ב-`dist/`) ושל מסמך האפיון לרפליקה הלא מקוונת, מול Google Chrome Modern Web Guidance.

הכלים: `npx -y modern-web-guidance@latest list|search|retrieve`, עם `--skill-version 2026_05_16-c5e7870` (גרסה שאושרה למשימה; לא שודרגה לגרסה חדשה יותר שה-CLI הציע). תחילה הורץ `list` (208 מדריכים בקטלוג), ואחר כך אוחזרו רק מדריכים רלוונטיים לאתר. לא הומצאו מזהי מדריכים.

מדיניות התמיכה שיושמה באתר החי (ונרשמה באפיון לרפליקה): **Baseline Widely available בלי נפילות לאחור**; **Newly available רק עם הנפילה הרשמית של המדריך**. יעד הרפליקה: Chromium, Edge ו-Firefox מודרניים ברשת סגורה (air-gapped). שינויים באתר החי הוגבלו לסיכון נמוך, בלי לשנות את המראה במצב בהיר כברירת מחדל וב«מודיעין לילי», בלי סקריפט מוטמע, ובלי לגעת ב-CSP או בשכבת הגישה.

מונחים טכניים להלן נשארים באנגלית. לכל מדריך: מצב נוכחי, פער, ושינוי שבוצע או דילוג מכוון.

---

## ערכת נושא וצבע

### dark-mode

- **מצב נוכחי:** יש מצב כהה «מודיעין לילי» דרך `html[data-theme="dark"]` והחלפת אסימוני CSS. כבר היה `color-scheme: dark` על המצב הכהה, והדפסה כופה פלטת נייר בהירה.
- **פער:** חסר `color-scheme: light` במצב ברירת המחדל, ולכן פקדי מערכת (גלילה, שדות, כפתורים) עלולים להישאר כהים על רקע בהיר אצל מי שערכת מערכת ההפעלה שלו כהה.
- **שינוי:** נוסף `:root { color-scheme: light }` ו-`<meta name="color-scheme" content="light">`. בבחירת מצב כהה, `theme.js` ו-`app.js` מעדכנים את המטא ל-`dark`. לא הוגדר `:root { color-scheme: light dark }` כי ברירת המחדל המוצרית היא בהירה, לא העדפת מערכת ההפעלה.

### dark-mode-toggle

- **מצב נוכחי:** לחצן ירח/שמש עם `aria-pressed` ושמירה ב-`localStorage` (`cto-review-theme`). `theme.js` רץ ב-`<head>` בלי `defer` כדי למנוע הבזק.
- **פער:** המדריך ממליץ לעקוב אחרי העדפת המערכת כברירת מחדל, ולשלב סקריפט מוטמע ב-`<head>` למניעת FOUC. גם מצב תלת-מצבי (מערכת / בהיר / כהה) מוצע.
- **דילוג מכוון (חלקי):** לא עוקבים אחרי `prefers-color-scheme` ולא מוסיפים מצב «מערכת» – דרישת המוצר היא מצב בהיר לכל מבקר ראשון, ואותו מראה. סקריפט מוטמע נדחה כי `script-src 'self'`. `theme.js` החיצוני ב-`<head>` הוא התחליף המותר. כן סונכרן `color-scheme` במטא עם הבחירה השמורה.

### color, component-specific-light-dark-theme, browser-ui-theming

- **מצב נוכחי:** ערכות צבע מוגדרות באסימונים על `:root` ועל `html[data-theme="dark"]`, לא ב-`light-dark()`. המטא `color-scheme` חסרה לפני הביקורת. אין ערכות נפרדות לרכיבים מעבר לאסימונים הגלובליים.
- **פער:** המדריך `color` מציג `light-dark()` (Newly available) כדרך לכתוב צבע לשתי ערכות באותו כלל.
- **שינוי / דילוג:** המטא ו-`color-scheme` יושמו (Widely available). לא הוסבו האסימונים ל-`light-dark()` – נדרשת נפילה שהיא למעשה ה-CSS הקיים, וסיכון גבוה לסטייה ויזואלית. אין צורך בערכות רכיב נפרדות.

### contrast-color, adapt-scrollbar-to-contrast-preferences

- **מצב נוכחי:** ניגודיות הטקסט והתגיות מכוילת ידנית לשתי הערכות. אין `scrollbar-color` או שימוש ב-`contrast-color()`.
- **פער:** `contrast-color()` ו-`scrollbar-color` הם Newly / מוגבלים לפי המדריכים, ודורשים נפילות.
- **דילוג מכוון:** לא מוסיפים `scrollbar-color` (נפילה ל-WebKit לא שווה את הסיכון/רעש). לא משתמשים ב-`contrast-color()` – הפלטה כבר קבועה ואין צורך בחישוב אוטומטי שעלול לשנות את המראה.

### child-state-based-styling

- **מצב נוכחי:** סינון תגיות, מצב טיפ (`.is-open`, `.tip-dismissed`) וסימון ניווט מטופלים במחלקות וב-`:hover` / `:focus-within`.
- **פער:** אין שימוש ב-`:has()` או ב-`item()` למצבי ילד מעבר למה שכבר עובד.
- **דילוג מכוון:** אין צורך לשכתב לוגיקה יציבה. `:focus-within` לטיפ נשאר.

---

## טיפים, popover ודיאלוגים

### interest-triggered-tooltips, position-aware-tooltips, hovercard, persistent-top-layer-ui, declarative-dialog-popover-control

- **מצב נוכחי:** טיפ החום הוא CSS+JS: תצוגה ב-`:hover` / `:focus-within` / `.is-open`, סגירה ב-Escape, לחיצה בחוץ ו-`mouseleave`. מיקום מוחלט מתחת ללהבות, עם מרווח 6px (`top: calc(100% + 6px)`).
- **פער:** המרווח יצר רווח שדרכו העכבר «נופל» לפני שהטיפ נעשה בר-ריחוף (WCAG 1.4.13 Hoverable). המדריכים מציעים Interest Invokers (`interestfor`, Limited, לא ב-Firefox), CSS Anchor Positioning (בגרסת המדריך הזו: Limited / ללא תמיכה ב-Chrome, Edge ו-Firefox), ו-Popover API (Newly available).
- **שינוי:** תוקן גשר הריחוף: הטיפ מתחיל ב-`top: 100%` עם `padding-top: 6px` שקוף, והמראה עבר ל-`.heat-tip-body`. יישור ל-`inset-inline-start` ו-`text-align: start`.
- **דילוג מכוון (באתר החי):** לא הוסב ל-`interestfor` (Limited, לא ב-Firefox שהוא יעד הרפליקה; polyfill מ-CDN אסור ב-CSP וברשת סגורה). לא הוסב ל-Anchor Positioning (לפי המדריך שאוחזר – Limited, ובלי polyfill). לא הוסב ל-Popover API באתר החי – Newly available קיים בדפדפני היעד, אבל מתנגש עם `display: none` של המחבר, עם גיליון ההדפסה, ועם דרישת «אותו מראה». באפיון הרפליקה מותר `popover="hint"` כשיפור הדרגתי עם נפילה ל-JS הקיים, לא כחובה.

### dialog, light-dismiss-a-dialog, prevent-page-scroll-under-modal-dialog, platform-controls-dismiss-dialog, html

- **מצב נוכחי:** באתר החי אין דיאלוג ייבוא (הייבוא הוא דרישת הרפליקה בלבד).
- **פער:** האפיון תיאר «דיאלוג» לאישור כפילות בלי לחייב `<dialog>` מקורי.
- **שינוי (אפיון בלבד):** אישור כפילות ומחיקה ברפליקה ישתמש ב-`<dialog>` (Widely available). אין להוסיף `role="dialog"` על `<dialog>` מקורי. `closedby` הוא Limited (בלי Safari במדריך) – אם נדרשת סגירה בלחיצה ברקע, יש ליישם את נפילת ה-JS של המדריך. Escape כבר סוגר דיאלוג מודאלי. מומלץ `overscroll-behavior` / מניעת גלילת הרקע כשהדיאלוג פתוח.
- **דילוג מכוון (באתר החי):** לא נוספה יכולת ייבוא JSON לייצור.

---

## טפסים, קבצים, גרירה וחיפוש

### forms, rich-media-picker

- **מצב נוכחי:** שדות הסינון באדמין וחיפוש הארכיון (`type="search"`) קיימים. ייבוא קבצים אינו באתר החי.
- **פער:** מתאר הפוקוס היה על `:focus` ולא על `:focus-visible`. באפיון, בחירת הקובץ כבר הוגדרה כ-`<input type="file" accept=".json,application/json" multiple>`.
- **שינוי:** שדות האדמין מקבלים מתאר ב-`:focus-visible` עם `outline-offset`. האפיון נשאר עם קלט קבצים מקורי (Widely available). `rich-media-picker` אינו רלוונטי (אין בחירת תמונה/מדיה).

### drag-and-drop, drag

- **מצב נוכחי:** אין גרירה באתר החי. האפיון דורש אזור גרירה לקובץ JSON.
- **פער:** מדריכים אלה עוסקים בעיקר בסידור מחדש של פריטים, לא בהפלת קובץ.
- **דילוג / הערה:** גרירת קובץ ברפליקה נשארת על אירועי `dragenter` / `dragover` / `drop` הסטנדרטיים ו-`DataTransfer.files`, בלי API לסידור מחדש. אין שינוי באתר החי.

### ime-safe-enter-submit

- **מצב נוכחי:** אין טופס שליחה עם Enter (החיפוש מסנן תוך כדי הקלדה).
- **דילוג מכוון:** אין טופס submit שדורש הגנה מ-IME.

### search-hidden-content

- **מצב נוכחי:** חיפוש הארכיון רץ על `search.json` ועל טקסט גלוי כנפילה. סינון תגיות מסתיר ידיעות ב-CSS (`hidden`) אבל החיפוש אינו אמור למצוא תוכן מוסתר בעמוד הסקירה.
- **פער:** המדריך מציע `hidden="until-found"` (Limited, בלי Safari).
- **דילוג מכוון:** Limited, ולא נחוץ לרשימת הארכיון הנוכחית. לא מופעל באתר החי.

---

## גופנים, טעינה וטיפוגרפיה

### typography, visually-stable-font-fallbacks, optimize-preload-priority, respect-os-text-scale, performance

- **מצב נוכחי:** Heebo משתנה עצמי, `font-display: swap`, subset עברית+לטינית. גודל הגוף היה `17px` קבוע. לא היה `preload` לגופן. לא היה `font-size-adjust`.
- **פער:** בלי preload הגופן מתגלה רק אחרי ה-CSS (LCP/FOIT/FOUT). `font-size` בפיקסלים חוסם סקייל טקסט של מערכת ההפעלה. חסר כוונון גודל לגופן הנפילה בזמן ההחלפה.
- **שינוי:** נוסף `<link rel="preload" href="…/heebo-var.woff2" as="font" type="font/woff2" crossorigin>` בתבנית (בלי `fetchpriority`). גודל הגוף הומר ל-`1.0625rem` (17px בשורש 16px) ושאר גדלי הטקסט ל-`rem`, כדי לכבד את סקייל מערכת ההפעלה בלי לשנות את המראה בזום 100%. נוסף `font-size-adjust: from-font` (Newly available; הנפילה הרשמית היא התעלמות). `overflow-wrap: break-word` על הגוף, ו-`anywhere` על שורות מקורות. `text-wrap: balance` בכותרות ו-`pretty` בפסקאות ארוכות כשיפור הדרגתי (דפדפן שאינו תומך מתעלם).
- **דילוג מכוון:** לא הוחלף `font-display: swap` ב-`optional` (עלול להשאיר עברית בגופן נפילה אם הגופן איטי). לא הוגדר גודל שורש קבוע בפיקסלים.

---

## CSS, פריסה, RTL ו-HTML

### css, css-layout, html, responsive-design, navbar

- **מצב נוכחי:** הפריסה ב-Grid, נקודות שבירה 900px ו-600px, `dir="rtl"`. ריפוד ומסגרות דקורטיביים היו במאפיינים פיזיים (`padding-right`, `border-right`, `margin-right`). חסר קישור דילוג לתוכן. ל-`main` לא היה `id`.
- **פער:** מאפיינים לוגיים עדיפים ל-RTL ולכיוון עתידי. חסר skip link. ניווט עליון כבר סמנטי עם `nav` ו-`aria-label`.
- **שינוי:** הומרו מאפיינים כיווניים ללוגיים (`padding-inline-start`, `border-inline-start`, `margin-inline-start` / `margin-inline-end`, `inset-inline-start`, `text-align: start`/`end`) תוך שמירה על המראה ב-RTL, כולל איי למותג (`margin-inline-start` על `.mark b`) ויישור `end` ב-`.sd dd.ltr`. נוסף קישור «דילוג לתוכן» אל `#main`, מוסתר חזותית עד פוקוס, ומוסתר בהדפסה. נקודות השבירה לא שונו.
- **דילוג מכוון:** ריפודים סימטריים (`padding: 28px 34px`) הושארו כקיצור פיזי, כי אין הבדל לוגי.

---

## נגישות ותנועה

### accessibility

- **מצב נוכחי:** `lang`/`dir`, ציוני `aria` לניווט, חיפוש וחום, ניגודיות מכוילת. מתאר פוקוס מותאם היה על `:focus` (גם בעכבר). לא היה skip link.
- **פער:** `:focus-visible` עדיף לרכיבים מותאמים. חסר קישור דילוג.
- **שינוי:** לחצן החום ושדות הסינון עוברים ל-`:focus-visible` (עם ביטול מתאר ב-`:focus` רק אחרי כלל ה-`:focus-visible`). נוסף skip link. במצב Forced Colors נוסף מתאר `Highlight` לשמירת נראות הפוקוס, ומסגרת לתגיות.

### motion, natural-interactions

- **מצב נוכחי:** `html { scroll-behavior: smooth }` תמיד, ומעבר `transform` על חץ ה-`<details>` באדמין, בלי התחשבות ב-`prefers-reduced-motion`.
- **פער:** המדריך דורש לא להפעיל גלילה חלקה או אנימציה כשהמשתמש מבקש הפחתת תנועה. אין לאפס גלובלית את כל `animation-duration`.
- **שינוי:** `scroll-behavior: smooth` ומעבר החץ רצים רק תחת `prefers-reduced-motion: no-preference`. מעבר קישור הדילוג מבוטל תחת `reduce`. לא אופס משך אנימציה גלובלי.

### accessible-generated-content

- **מצב נוכחי:** חץ דקורטיבי ב-`.src summary::before { content: "◂" }` עלול להיקרא בקורא מסך.
- **פער:** המדריך ממליץ על `content: "◂" / ""` (Newly available) עם נפילה לערך יחיד.
- **שינוי:** נוסף הכלל הכפול `content: "◂"; content: "◂" / "";` – דפדפן ישן נשאר עם הגליף, ודפדפן תומך מסמן אותו כדקורטיבי.

---

## ביצועים ומעברי עמוד

### defer-rendering-heavy-content, performance, improve-next-page-load-performance

- **מצב נוכחי:** רשימת האדמין כוללת מאות כרטיסי מקור. עמוד הסקירה היומית קצר יחסית (כ-18 ידיעות). אין `content-visibility`. אין Speculation Rules.
- **פער:** `content-visibility: auto` הוא Newly available (נפילה: התעלמות). יש לצרף `contain-intrinsic-size` ולא להפעיל מעל הקפל.
- **שינוי:** על כרטיסי מקור מה-12 ואילך: `content-visibility: auto; contain-intrinsic-size: auto none auto 72px`. לא הופעל על עמוד הסקירה (קצר, מעל הקפל).
- **דילוג מכוון:** Speculation Rules / prefetch לעמוד הבא דורשים רשת ותשתית שאינן חלק מהאתר הסטטי החי בסביבה הזו, ועלולות להרחיב מדיניות. לא נוספו.

### consistent-cross-document-transitions, directional-navigation-transitions, cross-document-transitions, same-document-transitions

- **מצב נוכחי:** ניווט קודם/הבא הוא קישור רגיל בין מסמכים, בלי `@view-transition`.
- **פער:** מעברי מסמך הם Limited ואינם נתמכים ב-Firefox. הם גם משנים את מראה הניווט (מעבר/עמעום במקום מעבר מיידי) ודורשים זהירות עם סקריפט ערכת הנושא בזמן המעבר.
- **דילוג מכוון (באתר החי):** לא מופעל, כדי לא לשנות מראה ולכבד את Firefox כיעד רפליקה. באפיון זה שיפור הדרגתי אופציונלי בלבד, כבוי תחת `prefers-reduced-motion: reduce`, ועם הנפילה «ניווט רגיל».

---

## אבטחה

### security, trusted-types, sanitize-untrusted-html

- **מצב נוכחי:** הגנרטור בורח תווים ב-HTML (`html.escape`). בצד הלקוח, תוכן מוזרם כטקסט ולא כ-`innerHTML` גולמי. CSP קיים עם `script-src 'self'` (בלי `unsafe-inline`).
- **פער:** אכיפת Trusted Types דורשת שינוי כותרת CSP (`require-trusted-types-for`).
- **דילוג מכוון:** לא משנים את ה-CSP. נשארים עם escape / `textContent`. האפיון מחייב את אותו כלל לייבוא JSON, בלי הרחבת CSP ובלי טעינת סקריפט מתוך הקובץ.

---

## מדריכים שאוחזרו וצוטטו

`dark-mode`, `dark-mode-toggle`, `color`, `component-specific-light-dark-theme`, `browser-ui-theming`, `contrast-color`, `adapt-scrollbar-to-contrast-preferences`, `child-state-based-styling`, `interest-triggered-tooltips`, `position-aware-tooltips`, `hovercard`, `declarative-dialog-popover-control`, `dialog`, `light-dismiss-a-dialog`, `prevent-page-scroll-under-modal-dialog`, `platform-controls-dismiss-dialog`, `persistent-top-layer-ui`, `forms`, `drag-and-drop`, `drag`, `rich-media-picker`, `ime-safe-enter-submit`, `search-hidden-content`, `typography`, `visually-stable-font-fallbacks`, `optimize-preload-priority`, `respect-os-text-scale`, `css`, `css-layout`, `html`, `responsive-design`, `navbar`, `accessibility`, `motion`, `natural-interactions`, `accessible-generated-content`, `defer-rendering-heavy-content`, `performance`, `improve-next-page-load-performance`, `consistent-cross-document-transitions`, `directional-navigation-transitions`, `cross-document-transitions`, `same-document-transitions`, `security`, `trusted-types`, `sanitize-untrusted-html`.

---

## סיכום יישום באתר החי

בוצע: `color-scheme` ומטא מסונכרנים; preload לגופן; גדלי טקסט ב-`rem`; `font-size-adjust: from-font`; מאפיינים לוגיים; `:focus-visible`; `prefers-reduced-motion`; גשר ריחוף לטיפ החום; skip link אל `#main`; `content: "…" / ""` לחץ דקורטיבי; `content-visibility` ברשימת האדמין; `text-wrap` ו-`overflow-wrap`; כללי Forced Colors מינימליים.

לא בוצע, במכוון: מעקב אחרי ערכת מערכת ההפעלה; `light-dark()`; סקריפט מוטמע; Interest Invokers; Anchor Positioning; Popover בטיפ החי; View Transitions; Trusted Types / שינוי CSP; ייבוא JSON באתר החי; `hidden="until-found"`; `scrollbar-color`; Speculation Rules; polyfills מ-CDN.

---

## תוספת 18 בנובמבר 2026: הרכיבים שנוספו ב-17 בנובמבר

נבדקו מול המדריכים `scroll-position-aware-elements`, `scroll-progress-indicator`, `copy-button` ו-`menu` (`--skill-version 2026_05_16-c5e7870`). לא שונה קוד באתר החי בעקבות הבדיקה; הפירוט המלא בסעיף 3.3 של מסמך האפיון.

- **«חזרה לראש העמוד» ו«פרקים» (`scroll-position-aware-elements`):** הפתרון הראשי במדריך הוא Container scroll-state queries (Limited), ולכן לא בשימוש. האתר משתמש ב-Advanced Fallback של המדריך: `IntersectionObserver` (Widely available) על הכותרת העליונה שמחליף את `html.is-scrolled`. המיקוד מועבר ל-`main` כשהלחצן מוסתר, כפי שהמדריך דורש. תואם.
- **פס התקדמות קריאה (`scroll-progress-indicator`):** Scroll-driven animations הן Newly available (מ-27.10.2026). השימוש בתוך `@supports (animation-timeline: scroll())`, והנפילה היא מאזין `scroll` פסיבי שמעדכן `transform`, כמו במדריך, בלי ה-polyfill שהמדריך אוסר. תואם.
- **תפריט «פרקים» (`menu`):** Popover API הוא Newly available (מ-27.1.2025). שימוש ב-`popovertarget` עם נפילה ידנית קטנה ב-`app.js`, בלי polyfill מרוחק. Anchor Positioning (Limited) ו-Invoker Commands (Newly available) לא בשימוש. תואם.
- **«שיתוף» (`copy-button`):** `clipboard.writeText` הוא Widely available; כישלון מוצג (נפילה ל-`execCommand` ואחריה דיאלוג העתקה ידנית). המדריך מציע חיבור דרך Invoker Commands; באתר החיבור ב-JS, כי היכולת Newly available ודורשת נפילת JS בכל מקרה. דילוג מכוון. Web Share API משמש רק כשיפור הדרגתי במכשירי מגע.
