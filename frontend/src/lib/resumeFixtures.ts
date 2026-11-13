/**
 * Realistic resumes in the shapes people actually submit, each with the facts a correct parse must produce.
 * Used only by tests. Dates are judged as of 2026-11-13.
 */
export type ResumeFixture = {
  name: string
  text: string
  expect: {
    fullName: string
    /** The latest job title as written on the resume ('' for a fresher with no job). */
    currentRole?: string
    jobs: { company: string; title: string }[]
    experience: string
    location?: string
    skills: string[]
    certs?: string[]
    /** Strings that must NOT appear anywhere in the parse (invented or leaked content). */
    absent?: string[]
  }
}

export const FIXTURES: ResumeFixture[] = [
  {
    name: 'fresher with projects and certifications',
    text: `ANITHA REDDY
Hyderabad, Telangana | +91 98480 12345 | anitha.reddy@gmail.com | linkedin.com/in/anithareddy
CAREER OBJECTIVE
Final year B.Tech student seeking an entry level software developer role to apply my Python and React skills.
EDUCATION
B.Tech in Computer Science and Engineering, JNTU Hyderabad, 2022 - 2026, CGPA 8.4
Intermediate (MPC), Sri Chaitanya Junior College, 2020 - 2022, 96%
TECHNICAL SKILLS
Languages: Python, Java, JavaScript, SQL
Web: React, HTML, CSS, Node.js
Tools: Git, VS Code, Postman
PROJECTS
Student Attendance Tracker | React | Node.js | MongoDB
• Built a web app that records attendance with QR codes for 300 students.
Library Management System | Java | MySQL
• Designed the database schema and CRUD screens.
CERTIFICATIONS
Python for Everybody - Coursera
AWS Cloud Practitioner Essentials - Amazon Web Services`,
    expect: {
      fullName: 'Anitha Reddy',
      jobs: [],
      experience: 'Fresher / 0 years',
      location: 'Hyderabad',
      skills: ['Python', 'Java', 'JavaScript', 'SQL', 'React', 'Node.js', 'Git'],
      certs: ['Python for Everybody', 'AWS Cloud Practitioner Essentials'],
      absent: ['Techcitta', 'driven by building'],
    },
  },
  {
    name: 'experienced java developer, dash format',
    text: `Rahul Sharma
Senior Java Developer
Bengaluru, India · rahul.sharma@outlook.com · +91 99000 11223
PROFESSIONAL SUMMARY
Java developer with 8 years of experience building payment platforms and microservices using Spring Boot and Kafka.
WORK EXPERIENCE
Senior Java Developer - Razorpay Software Pvt Ltd
Jun 2021 - Present
• Led a team of 5 building the settlement microservice on Spring Boot and Kafka.
• Cut reconciliation time by 45% with batch optimisation.
Java Developer - Infosys Limited
Aug 2017 - May 2021
• Developed REST APIs for a banking client using Spring and Oracle.
EDUCATION
B.E. Computer Science, Anna University, 2013 - 2017
SKILLS
Java, Spring Boot, Kafka, Microservices, Oracle, PostgreSQL, Docker, Kubernetes, AWS, Git`,
    expect: {
      fullName: 'Rahul Sharma',
      currentRole: 'Senior Java Developer',
      jobs: [
        { company: 'Razorpay Software Pvt Ltd', title: 'Senior Java Developer' },
        { company: 'Infosys Limited', title: 'Java Developer' },
      ],
      experience: '8 – 12 Years',
      location: 'Bengaluru',
      skills: ['Java', 'Spring Boot', 'Kafka', 'PostgreSQL', 'Docker', 'Kubernetes', 'AWS', 'Git'],
    },
  },
  {
    name: 'title at company with parenthesised dates',
    text: `Meera Iyer
Full Stack Engineer | Chennai
meera.iyer@example.com | 9876543210
EXPERIENCE
Full Stack Engineer at Zoho Corporation (Mar 2022 - Present)
- Built customer onboarding flows in React and Node.js used by 20,000 users.
Software Engineer at Freshworks (Jul 2019 - Feb 2022)
- Developed internal tooling in Ruby on Rails.
SKILLS
React, Node.js, Ruby on Rails, PostgreSQL, Redis, TypeScript
EDUCATION
B.Tech Information Technology, SRM University, 2015 - 2019`,
    expect: {
      fullName: 'Meera Iyer',
      currentRole: 'Full Stack Engineer',
      jobs: [
        { company: 'Zoho Corporation', title: 'Full Stack Engineer' },
        { company: 'Freshworks', title: 'Software Engineer' },
      ],
      experience: '5 – 8 Years',
      location: 'Chennai',
      skills: ['React', 'Node.js', 'PostgreSQL', 'Redis', 'TypeScript'],
    },
  },
  {
    name: 'company first, title and dates on the next line',
    text: `Karthik Subramanian
Data Analyst
Pune, Maharashtra | karthik.s@mail.com | +91 91234 56789
EXPERIENCE
Tata Consultancy Services
Data Analyst Jan 2022 - Present
• Built Power BI dashboards tracking 40 KPIs for a retail client.
• Wrote SQL queries over 200M-row tables.
Wipro Technologies
Junior Analyst Jun 2020 - Dec 2021
• Cleaned and reported weekly sales data in Excel.
EDUCATION
B.Sc Statistics, Fergusson College, 2017 - 2020
SKILLS
SQL, Power BI, Excel, Python, Tableau`,
    expect: {
      fullName: 'Karthik Subramanian',
      currentRole: 'Data Analyst',
      jobs: [
        { company: 'Tata Consultancy Services', title: 'Data Analyst' },
        { company: 'Wipro Technologies', title: 'Junior Analyst' },
      ],
      experience: '5 – 8 Years',
      location: 'Pune',
      skills: ['SQL', 'Power BI', 'Excel', 'Python', 'Tableau'],
    },
  },
  {
    name: 'numeric dates with slashes',
    text: `Divya Nair
QA Engineer
Kochi, Kerala
divya.nair@example.org | +91 90000 22222
WORK HISTORY
QA Engineer | UST Global | 03/2019 – 06/2022
- Wrote Selenium and Cypress suites covering 600 test cases.
Senior QA Engineer | Quest Global | 07/2022 – Present
- Owned release sign-off for two products.
SKILLS
Selenium, Cypress, JMeter, Postman, Jira, SQL`,
    expect: {
      fullName: 'Divya Nair',
      currentRole: 'Senior QA Engineer',
      jobs: [
        { company: 'UST Global', title: 'QA Engineer' },
        { company: 'Quest Global', title: 'Senior QA Engineer' },
      ],
      experience: '5 – 8 Years',
      skills: ['Selenium', 'Cypress', 'JMeter', 'Postman', 'Jira', 'SQL'],
    },
  },
  {
    name: 'internship only, final year student',
    text: `Rohit Verma
Final Year B.Tech Student | Noida, Uttar Pradesh
rohit.verma@example.com | +91 98765 00000
EXPERIENCE
Software Development Intern, Zenith Labs
Jun 2025 - Aug 2025
• Built an admin dashboard in React.
EDUCATION
B.Tech Computer Science, AKTU, 2022 - 2026
SKILLS
React, JavaScript, HTML, CSS, Git`,
    expect: {
      fullName: 'Rohit Verma',
      jobs: [{ company: 'Zenith Labs', title: 'Software Development Intern' }],
      experience: 'Fresher / 0 years',
      skills: ['React', 'JavaScript', 'HTML', 'CSS', 'Git'],
    },
  },
  {
    name: 'freelancer working to the present',
    text: `Sneha Kulkarni
Freelance Web Developer
Mumbai, India | sneha.k@example.com | +91 98200 33333
EXPERIENCE
Freelance Web Developer - Self Employed
Jan 2020 - Present
• Delivered 25 websites for small businesses using WordPress and React.
SKILLS
WordPress, React, JavaScript, PHP, MySQL, Figma`,
    expect: {
      fullName: 'Sneha Kulkarni',
      currentRole: 'Freelance Web Developer',
      jobs: [{ company: 'Self Employed', title: 'Freelance Web Developer' }],
      experience: '5 – 8 Years',
      location: 'Mumbai',
      skills: ['WordPress', 'React', 'JavaScript', 'PHP', 'MySQL', 'Figma'],
    },
  },
  {
    name: 'non-IT civil engineer',
    text: `Suresh Babu Naidu
Civil Engineer
Visakhapatnam, Andhra Pradesh | suresh.naidu@example.com | +91 94400 55555
EXPERIENCE
Site Engineer - L&T Construction
Feb 2018 - Dec 2022
• Supervised RCC work for a 14 storey residential tower.
Senior Site Engineer - Shapoorji Pallonji
Jan 2023 - Present
• Managed a 60 member workforce and BBS planning.
EDUCATION
B.Tech Civil Engineering, Andhra University, 2014 - 2018
SKILLS
AutoCAD, STAAD Pro, Primavera P6, Quantity Surveying, Site Management`,
    expect: {
      fullName: 'Suresh Babu Naidu',
      currentRole: 'Senior Site Engineer',
      jobs: [
        { company: 'L&T Construction', title: 'Site Engineer' },
        { company: 'Shapoorji Pallonji', title: 'Senior Site Engineer' },
      ],
      experience: '8 – 12 Years',
      skills: ['AutoCAD', 'STAAD Pro', 'Primavera P6'],
      absent: ['React', 'Python', 'Software Engineer'],
    },
  },
  {
    name: 'nurse, healthcare',
    text: `PRIYA D'SOUZA
Registered Nurse
Goa, India | priya.dsouza@example.com | +91 98220 66666
SUMMARY
Registered nurse with 6 years of experience in ICU and emergency care.
EXPERIENCE
Staff Nurse - Manipal Hospital
Apr 2019 - Present
• Cared for 8 critical patients per shift in the ICU.
Nurse Trainee - Goa Medical College
Jan 2018 - Mar 2019
• Assisted ward rounds.
EDUCATION
B.Sc Nursing, Goa University, 2014 - 2018
SKILLS
Patient Care, ICU, BLS, ACLS, Ventilator Management`,
    expect: {
      fullName: "Priya D'Souza",
      currentRole: 'Staff Nurse',
      jobs: [
        { company: 'Manipal Hospital', title: 'Staff Nurse' },
        { company: 'Goa Medical College', title: 'Nurse Trainee' },
      ],
      experience: '8 – 12 Years',
      skills: ['Patient Care', 'ICU', 'BLS', 'ACLS'],
      absent: ['React', 'Python'],
    },
  },
  {
    name: 'name with initials and inline contact',
    text: `K. Ravi Teja
Backend Developer
Gachibowli, Hyderabad | ravi.teja@example.com | 9000011111 | github.com/raviteja
EXPERIENCE
Backend Developer, Mindtree Ltd (Feb 2023 - Present)
• Built Go and gRPC services handling 3000 requests per second.
SKILLS
Go, gRPC, PostgreSQL, Docker, Redis, AWS`,
    expect: {
      fullName: 'K. Ravi Teja',
      currentRole: 'Backend Developer',
      jobs: [{ company: 'Mindtree Ltd', title: 'Backend Developer' }],
      experience: '3 – 5 Years',
      location: 'Hyderabad',
      skills: ['Go', 'gRPC', 'PostgreSQL', 'Docker', 'Redis', 'AWS'],
    },
  },
  {
    name: 'manager with a long career and no skills heading',
    text: `Anil Kapoor
Engineering Manager
Gurugram, Haryana | anil.kapoor@example.com | +91 98100 77777
PROFESSIONAL EXPERIENCE
Engineering Manager, Paytm (2019 - Present)
Led 4 teams (28 engineers) across payments and lending.
Technical Lead, Flipkart (2015 - 2019)
Architected the order management service.
Software Engineer, Amazon (2010 - 2015)
Built catalogue ingestion pipelines in Java.
EDUCATION
B.Tech, IIT Delhi, 2006 - 2010`,
    expect: {
      fullName: 'Anil Kapoor',
      currentRole: 'Engineering Manager',
      jobs: [
        { company: 'Paytm', title: 'Engineering Manager' },
        { company: 'Flipkart', title: 'Technical Lead' },
        { company: 'Amazon', title: 'Software Engineer' },
      ],
      experience: '12+ Years',
      skills: ['Java'],
    },
  },
  {
    name: 'professional with two roles at one company and an intern stint',
    text: `Pooja Menon
Product Analyst
Bengaluru | pooja.menon@example.com | +91 98860 88888
EXPERIENCE
Product Analyst, Swiggy
Apr 2023 - Present
• Defined retention metrics for the Instamart funnel.
Associate Product Analyst, Swiggy
Jan 2022 - Mar 2023
• Built weekly dashboards in Looker.
Product Intern, Cred
Jun 2021 - Dec 2021
• Ran 6 user interviews.
SKILLS
SQL, Looker, Amplitude, Excel`,
    expect: {
      fullName: 'Pooja Menon',
      currentRole: 'Product Analyst',
      jobs: [
        { company: 'Swiggy', title: 'Product Analyst' },
        { company: 'Swiggy', title: 'Associate Product Analyst' },
        { company: 'Cred', title: 'Product Intern' },
      ],
      experience: '3 – 5 Years',
      skills: ['SQL', 'Looker', 'Amplitude', 'Excel'],
    },
  },
  {
    name: 'plain minimal resume, no sections',
    text: `Imran Khan
imran.khan@example.com
+91 90909 90909
Software Tester with 3 years of experience in manual and automation testing using Selenium and Java.
Worked at Capgemini from 2022 to 2025.`,
    expect: {
      fullName: 'Imran Khan',
      jobs: [],
      experience: '2 – 3 Years',
      skills: ['Selenium', 'Java'],
    },
  },
  {
    name: 'apostrophe-year and abbreviated month dates',
    text: `Vikram Singh Rathore
Android Developer
Jaipur, Rajasthan | vikram.rathore@example.com | +91 98290 12121
PROFESSIONAL EXPERIENCE
Android Developer, Zomato Media Pvt. Ltd.
Sept. 2021 – Present
• Built the order tracking screen in Kotlin and Jetpack Compose.
Junior Android Developer, Appinventiv
Jan 2019 – Aug 2021
• Maintained 3 consumer apps with 1M+ installs.
SKILLS
Kotlin, Java, Jetpack Compose, Retrofit, Firebase, Git`,
    expect: {
      fullName: 'Vikram Singh Rathore',
      currentRole: 'Android Developer',
      jobs: [
        { company: 'Zomato Media Pvt. Ltd.', title: 'Android Developer' },
        { company: 'Appinventiv', title: 'Junior Android Developer' },
      ],
      experience: '5 – 8 Years',
      skills: ['Kotlin', 'Java', 'Jetpack Compose', 'Retrofit', 'Firebase', 'Git'],
    },
  },
  {
    name: 'all caps headings with colons and inline skills',
    text: `LAKSHMI NARAYANAN
DevOps Engineer | Coimbatore, Tamil Nadu | lakshmi.n@example.com | 9444012345
SKILLS: AWS, Terraform, Jenkins, Docker, Kubernetes, Linux, Bash, Python
WORK EXPERIENCE:
DevOps Engineer at Cognizant Technology Solutions (Oct 2020 - Present)
- Automated 40 CI/CD pipelines using Jenkins and Terraform.
EDUCATION:
B.E. Electronics, PSG College of Technology, 2016 - 2020
CERTIFICATIONS:
AWS Certified Solutions Architect - Associate - Amazon Web Services
Certified Kubernetes Administrator - CNCF`,
    expect: {
      fullName: 'Lakshmi Narayanan',
      currentRole: 'DevOps Engineer',
      jobs: [{ company: 'Cognizant Technology Solutions', title: 'DevOps Engineer' }],
      experience: '5 – 8 Years',
      skills: ['AWS', 'Terraform', 'Jenkins', 'Docker', 'Kubernetes', 'Linux', 'Bash', 'Python'],
    },
  },
  {
    name: 'repeated page header and footer text',
    text: `Farhan Ahmed
Machine Learning Engineer
Hyderabad | farhan.ahmed@example.com | +91 99999 11111
EXPERIENCE
Machine Learning Engineer, Qualcomm India Pvt Ltd
Jul 2022 - Present
• Trained vision models in PyTorch for on-device inference.
Farhan Ahmed - Resume
Page 2 of 2
Associate Engineer, Qualcomm India Pvt Ltd
Jul 2020 - Jun 2022
• Wrote test harnesses in Python.
SKILLS
Python, PyTorch, TensorFlow, OpenCV, Docker`,
    expect: {
      fullName: 'Farhan Ahmed',
      currentRole: 'Machine Learning Engineer',
      jobs: [
        { company: 'Qualcomm India Pvt Ltd', title: 'Machine Learning Engineer' },
        { company: 'Qualcomm India Pvt Ltd', title: 'Associate Engineer' },
      ],
      experience: '5 – 8 Years',
      skills: ['Python', 'PyTorch', 'TensorFlow', 'OpenCV', 'Docker'],
    },
  },
  {
    name: 'projects with dates but no job',
    text: `Tanvi Joshi
Computer Science Undergraduate | Pune
tanvi.joshi@example.com | +91 90110 22222
EDUCATION
B.E. Computer Engineering, Savitribai Phule Pune University, 2021 - 2025
PROJECTS
Weather Forecast App (Jan 2024 - Mar 2024)
• Built with React and OpenWeather API.
Expense Splitter (Aug 2023 - Oct 2023)
• Flask and SQLite backend.
SKILLS
Python, Flask, React, SQLite, Git
ACHIEVEMENTS
Winner, Smart India Hackathon 2024`,
    expect: {
      fullName: 'Tanvi Joshi',
      jobs: [],
      experience: 'Fresher / 0 years',
      location: 'Pune',
      skills: ['Python', 'Flask', 'React', 'SQLite', 'Git'],
    },
  },
  {
    name: 'experience written as a year range without months',
    text: `Gopal Krishnan
Senior Accountant
Madurai, Tamil Nadu | gopal.k@example.com | +91 98430 33333
EXPERIENCE
Senior Accountant, Sundaram Finance Ltd, 2016 – 2024
• Managed month-end close and GST filing for 4 branches.
Accounts Executive, Ashok Leyland, 2012 – 2016
• Handled payables and bank reconciliation.
SKILLS
Tally, GST, Excel, SAP, Bank Reconciliation`,
    expect: {
      fullName: 'Gopal Krishnan',
      currentRole: 'Senior Accountant',
      jobs: [
        { company: 'Sundaram Finance Ltd', title: 'Senior Accountant' },
        { company: 'Ashok Leyland', title: 'Accounts Executive' },
      ],
      experience: '12+ Years',
      skills: ['Tally', 'GST', 'Excel', 'SAP'],
    },
  },
  {
    name: 'overseas candidate with city and country',
    text: `Emily Carter
Senior Software Engineer
London, UK | emily.carter@example.co.uk | +44 7700 900123 | github.com/ecarter
SUMMARY
Backend engineer with 9+ years of experience building distributed systems in Go and Java.
EXPERIENCE
Senior Software Engineer, Monzo Bank (Mar 2020 - Present)
- Led the payments reliability team.
Software Engineer, Skyscanner (Sep 2016 - Feb 2020)
- Built search ranking services in Java.
EDUCATION
BSc Computer Science, University of Manchester, 2013 - 2016
SKILLS
Go, Java, Kafka, PostgreSQL, Kubernetes, AWS`,
    expect: {
      fullName: 'Emily Carter',
      currentRole: 'Senior Software Engineer',
      jobs: [
        { company: 'Monzo Bank', title: 'Senior Software Engineer' },
        { company: 'Skyscanner', title: 'Software Engineer' },
      ],
      experience: '8 – 12 Years',
      location: 'London, UK',
      skills: ['Go', 'Java', 'Kafka', 'PostgreSQL', 'Kubernetes', 'AWS'],
      absent: ['Hyderabad', 'Bengaluru'],
    },
  },
  {
    name: 'teacher',
    text: `Ananya Bose
Mathematics Teacher
Kolkata, West Bengal | ananya.bose@example.com | +91 98300 44444
EXPERIENCE
Mathematics Teacher - La Martiniere for Girls School
Jul 2017 - Present
• Taught grades 9 to 12 and mentored the Olympiad team.
Teaching Assistant - Presidency University
Aug 2015 - Jun 2017
EDUCATION
M.Sc Mathematics, Presidency University, 2013 - 2015
SKILLS
Curriculum Design, Classroom Management, GeoGebra`,
    expect: {
      fullName: 'Ananya Bose',
      currentRole: 'Mathematics Teacher',
      jobs: [
        { company: 'La Martiniere for Girls School', title: 'Mathematics Teacher' },
        { company: 'Presidency University', title: 'Teaching Assistant' },
      ],
      experience: '8 – 12 Years',
      skills: ['Curriculum Design', 'Classroom Management', 'GeoGebra'],
      absent: ['React', 'Python'],
    },
  },
]
