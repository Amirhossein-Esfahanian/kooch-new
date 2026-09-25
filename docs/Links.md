https://21st.dev/@erikx/components/loader
https://codepen.io/aurer/pen/ZEJxpO
https://codepen.io/Manoz/pen/kyWvQw
https://codepen.io/bernethe/pen/dorozd

https://codepen.io/martinvd/pen/xbQJom

https://21st.dev/@easemize/components/material-ui-autocomplete-combobox-multi-select/multi-select

https://21st.dev/@flower0wine/components/multi-select

https://21st.dev/@serafim/themes/amber-slate

https://ui.shadcn.com/docs/components/radix/dialog

https://codepen.io/caseycallow/pen/yaGQMo

https://codepen.io/ashleynolan/pen/wBppKz

آپلود مدرک پرداخت دستی توسط مهمان
فعلاً حذف شد. مهمان مدرک را بیرون از Kooch مثل WhatsApp/Telegram می‌فرستد و Admin پرداخت را ثبت می‌کند. بعداً می‌توانیم upload امن JPEG/PNG/PDF، ownership فایل و lifecycle آن را اضافه کنیم.
ثبت پرداخت دستی توسط خود Guest در سایت
همان A3.3 است و فعلاً Deferred شد. الان فقط Admin می‌تواند Manual Payment را ثبت و سپس تأیید/رد کند.
Evidence Source برای پرداخت دستی
فعلاً Notes کافی است. بعداً در صورت نیاز می‌توانیم مشخص کنیم مدرک از Uploaded / WhatsApp / Telegram / Email / Other آمده است.
Separation of Duties در پرداخت دستی
فعلاً یک Admin می‌تواند هم پرداخت را ثبت کند و هم خودش تأیید کند. در آینده اگر کنترل مالی سخت‌گیرانه‌تر خواستیم، می‌توانیم الزام کنیم SubmittedBy != VerifiedBy یا تأیید دوم داشته باشیم.
Referral Link و Referral Code واقعی
نوع‌های کمیسیونشان ساخته و روی Reservation قابل snapshot هستند، اما خود workflow هنوز ساخته نشده:
لینک اختصاصی هر اقامتگاه
کد معرفی اقامتگاه
تشخیص خودکار CommissionType هنگام ایجاد Reservation
مدیریت نرخ اختصاصی کمیسیون اقامتگاه در UI
PropertyCommissionRate در backend وجود دارد، اما UI برای تعیین نرخ اختصاصی هر سه نوع کمیسیون هنوز ساخته نشده است.
Voucher
هنوز شروع نشده. قرار است جداگانه شامل:
snapshot/domain ووچر
صدور بعد از Confirm
Guest Voucher
Owner Voucher
PDF/Print
ارسال و ثبت metadata ارسال
باشد.
Settlement کامل با مالک
هنوز پیاده نشده:
Pending → Due → Overdue → Paid
Due Date بر اساس BaseDate + OffsetDays
پیش‌فرض Check-out + 0
Settlement Batch برای چند رزرو
ثبت انتقال بانکی توسط Admin
Settlement Receipt
Property-specific Settlement Rule
گفتیم مدل باید در آینده override اختصاصی اقامتگاه را پشتیبانی کند؛ مثلاً یک Property به‌جای Checkout+0، Checkout+3 داشته باشد.
Owner Finance Workspace
فعلاً نساختیم. بعداً مالک حداقل Pending / Due / Paid / Settlement History و Settlement Receiptها را خواهد دید.
Cancellation accounting
هنوز financial workflow آن ساخته نشده. قرار است cancellation رکوردهای قبلی را overwrite نکند و با Adjustment/Debit/Credit ادامه پیدا کند.
Refund
هنوز پیاده نشده:
Partial/Full refund
manual refund
refund reference/evidence
allocation در BookingSession
وضعیت‌های NotRequired / Pending / Partial / Completed
Property Debit / Credit و Adjustment
مخصوصاً وقتی قبلاً به مالک Settlement شده ولی بعداً Cancellation باعث کاهش سهم نهایی او شود. اختلاف باید به‌عنوان entry جدید ثبت و از Settlementهای بعدی کم شود.
Finance Admin کامل
foundation مالی و ledger را داریم، اما UI عملیاتی کامل هنوز مانده:
Overview
Transactions
Commission
Property balances
Settlements
Refunds/Adjustments
Settlement Receipt و ارسال برای مالک
تولید سند، WhatsApp/Telegram و metadataهایی مثل ReceiptGeneratedAt, ReceiptSentAt, ReceiptSentVia, ReceiptSentTo هنوز برای آینده‌اند.
CapacityLost reconciliation
الان اگر پول واقعاً دریافت شده ولی ظرفیت از بین برود:
Payment = Successful و Reservation = CapacityLost
می‌شود و عمداً PropertyPayable ساخته نمی‌شود. Refund/Reconciliation این حالت را بعداً باید کامل کند.
Currency-specific rounding / minor units
فعلاً همه محاسبات مالی با 2 رقم اعشار و AwayFromZero هستند. اگر بعداً بخواهیم IRR یا ارزهای دیگر minor-unit متفاوت داشته باشند، جداگانه توسعه می‌دهیم.
Partial-payment architecture در مقیاس کامل
سیستم فعلی accumulated successful payments را در بعضی مسیرها لحاظ می‌کند، ولی اگر partial payment به‌عنوان feature رسمی و گسترده بخواهیم، uniqueness و snapshot semantics باید دوباره بررسی شوند.
درگاه واقعی و Direct Payment API کامل
Audit نشان داده بود provider واقعی production هنوز کامل نیست و مسیر direct payment خارجی هم کامل به gateway متصل نشده. این هم یک توسعه بعدی است.
تعیین شرایط کنسلی
