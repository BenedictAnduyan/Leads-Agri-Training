# Leads Training (PHP + MySQL version)

Employee training website for Leads Agricultural Products Corporation. HTML screens, CSS design, JavaScript for the screens, PHP for the server, MySQL for the data.

## Setup in XAMPP (Windows)
1. Open XAMPP Control Panel and start Apache and MySQL.
2. Copy this whole folder to C:\xampp\htdocs\leads-training (so that C:\xampp\htdocs\leads-training\index.html exists).
3. Open http://localhost/phpmyadmin, click Import, choose sql\schema.sql from this folder, and click Import. This creates the database leads_training with all tables and the demo data. Importing again resets everything.
4. Open http://localhost/leads-training/ in the browser. Do not use Live Server, because it cannot run PHP.

If MySQL has a password, or the database has another name, change the first lines of api\config.php.

## Demo accounts
| Role | Email | Password |
|---|---|---|
| Admin | admin@leads.com | admin123 |
| Employee (John, 5 of 6 cards done) | john@leads.com | john123 |
| Employee | maria@leads.com | maria123 |
| Employee | paul@leads.com | paul123 |
| Employee (IT, evaluator) | sherwin@leads.com | sherwin123 |
| Employee (IT, evaluator) | jel@leads.com | jel123 |

## Folders
- index.html : every screen as a <template> (read the comment at the top).
- css/style.css : design.
- js/app.js, js/admin.js, js/main.js : screens and logic. They only ask the server for data.
- api/*.php : the server. config.php (database login), helpers.php (shared code), auth.php, snapshot.php, employee.php, admin.php.
- sql/schema.sql : tables and demo data.

## What the server decides (so it cannot be cheated in the browser)
- Passwords are saved as hashes, and login uses a PHP session.
- Locked cards: the server refuses to send the material of a card unless the card before it is passed.
- Quiz: the browser never receives the correct answers. Each answer is checked by the server, which then shows the correct answer and explanation. The server counts the score and decides pass or fail.
- Admin functions are refused for employees on the server.

## Database tables
users, courses, training_cards, quiz_questions, course_assignments, card_progress, quiz_attempts, question_answers, notifications, support_requests, activity_log, suppliers (Supplier Master), criteria_master (Criteria Master), supplier_evaluations (form answers).

## IT Supplier & Third-Party Evaluation (course "IT Supplier Management", card "IT Supplier & Third-Party Evaluation")
This card is the Google Form built into the website. The employee reads the material, then opens the form. Suppliers never answer it.
- Supplier Name is a list taken from the Supplier Master. Category, contact person, contact no. and email fill in by themselves.
- The Evaluator is the logged-in employee. Evaluation Date starts as today. Service, criticality, the eight ratings, the three Yes/No questions, the recommendation and the comments follow the Google Form. The corrective action section appears only when "Is corrective action required?" is Yes.
- Submitting saves the answers in supplier_evaluations, completes the card, and updates the Supplier Master (status, current score, last evaluation).
- The next evaluation is always 3 months after the evaluation date. There is no contract expiry.

### How the score is calculated
The form has eight questions and the Criteria Master has eight criteria, but they are not the same list, so they are connected like this (table criteria_master, column source_keys).
- Quality of Products/Services is Product / Service Quality.
- Delivery Performance is Delivery / Commitment.
- Technical Capability and Issue Resolution both use Technical Support / Issue Resolution.
- Cost / Value is Cost / Value.
- Customer Support / Responsiveness is the average of Response Time and Communication & Professionalism.
- Security / Compliance is Security / Compliance.
- Reliability / Business Continuity is Reliability / Availability.

Overall score = sum of (weight x rating) / 5. 90% and above is Excellent (Preferred Supplier), 80 to 89.9% is Good (Approved), 70 to 79.9% is Acceptable (Conditional), below 70% is Poor (Not Recommended). The weight shown beside each form question is worked out from the Criteria Master, so it always matches the real calculation. Admin > Supplier Evaluation > Criteria Master can change the weights (they must add up to 100). The thresholds are in function thresholds() in api/helpers.php.

### Admin pages (Admin > Supplier Evaluation)
Dashboard, Evaluation Responses, Evaluation Calculator, Supplier Master (add and edit suppliers) and Criteria Master. They are built from the latest evaluation of each supplier.
