require('dotenv').config();
const express = require('express');
const path = require('path');
const { connectDatabase, getDatabase, closeDatabase, newStudentId } = require('./db');
const { BRANCHES, SEMESTERS, BRANCH_BY_NAME } = require('./curriculum');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function validText(value, maxLength = 120) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function parseSemester(value) {
  if (value === undefined || value === null || value === '') return null;
  const semester = Number(value);
  return Number.isInteger(semester) && SEMESTERS.includes(semester) ? semester : NaN;
}
function coursePerformancePipeline({ department, semester } = {}) {
  const studentMatch = {};
  if (department) studentMatch.department = department;
  if (semester) studentMatch.semester = semester;
  return [
    { $match: studentMatch },
    { $unwind: '$marks' },
    { $lookup: { from: 'courses', localField: 'marks.courseCode', foreignField: 'courseCode', as: 'course' } },
    { $unwind: '$course' },
    // A mark contributes only when the course belongs to this student's branch and semester.
    { $match: { $expr: { $and: [
      { $eq: ['$department', '$course.department'] },
      { $eq: ['$semester', '$course.semester'] }
    ] } } },
    { $group: {
      _id: '$course.courseCode',
      studentIds: { $addToSet: '$studentId' },
      averageMarks: { $avg: '$marks.marks' },
      highestMarks: { $max: '$marks.marks' },
      lowestMarks: { $min: '$marks.marks' },
      courseName: { $first: '$course.courseName' },
      department: { $first: '$course.department' },
      semester: { $first: '$course.semester' }
    } },
    { $project: {
      _id: 0,
      courseCode: '$_id',
      courseName: 1,
      department: 1,
      semester: 1,
      totalStudents: { $size: '$studentIds' },
      averageMarks: { $round: ['$averageMarks', 2] },
      highestMarks: 1,
      lowestMarks: 1
    } },
    { $sort: { semester: 1, department: 1, courseCode: 1 } }
  ];
}

async function nextCourseCode(courses, department, semester) {
  const branch = BRANCH_BY_NAME[department];
  const prefix = `${branch.code}${semester}`;
  const existing = await courses.find({ department, semester }).project({ courseCode: 1 }).toArray();
  const used = new Set(existing.map(course => course.courseCode));
  for (let number = 1; number <= 99; number += 1) {
    const code = `${prefix}${String(number).padStart(2, '0')}`;
    if (!used.has(code)) return code;
  }
  throw new Error(`No course-code slots remain for ${department}, semester ${semester}.`);
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'Student Performance API is running.' }));
app.get('/api/config', (req, res) => res.json({ branches: BRANCHES, semesters: SEMESTERS }));

app.get('/api/courses', async (req, res, next) => {
  try {
    const department = String(req.query.department || '').trim();
    const semester = parseSemester(req.query.semester);
    if (semester !== null && !Number.isInteger(semester)) return res.status(400).json({ message: 'Semester must be from 1 to 8.' });
    if (department && !BRANCH_BY_NAME[department]) return res.status(400).json({ message: 'Choose a valid branch.' });
    const query = {};
    if (department) query.department = department;
    if (semester) query.semester = semester;
    const courses = await getDatabase().collection('courses').find(query).sort({ semester: 1, department: 1, courseCode: 1 }).toArray();
    res.json(courses);
  } catch (error) { next(error); }
});

app.post('/api/courses', async (req, res, next) => {
  try {
    const { courseName, department, semester: semesterValue, credits: creditsValue } = req.body;
    const semester = Number(semesterValue);
    const credits = Number(creditsValue);
    if (!validText(courseName, 120) || !BRANCH_BY_NAME[department] ||
        !Number.isInteger(semester) || !SEMESTERS.includes(semester) ||
        !Number.isInteger(credits) || credits < 1 || credits > 10) {
      return res.status(400).json({ message: 'Choose a branch and semester, enter a course name, and set credits from 1 to 10.' });
    }

    const courses = getDatabase().collection('courses');
    const duplicateName = await courses.findOne({
      department,
      semester,
      courseName: { $regex: `^${escapeRegex(courseName.trim())}$`, $options: 'i' }
    });
    if (duplicateName) return res.status(409).json({ message: 'This subject already exists for that branch and semester.' });

    // The server generates the course code; users cannot accidentally use the wrong branch/semester prefix.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const courseCode = await nextCourseCode(courses, department, semester);
      const course = {
        courseCode,
        courseName: courseName.trim(),
        department,
        branchCode: BRANCH_BY_NAME[department].code,
        semester,
        credits,
        isCoreCurriculum: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      try {
        await courses.insertOne(course);
        return res.status(201).json({ message: `Course added successfully with code ${courseCode}.`, course });
      } catch (error) {
        if (error.code === 11000 && error.keyPattern?.courseCode && attempt < 4) continue;
        if (error.code === 11000) return res.status(409).json({ message: 'That course or subject already exists. Refresh and try again.' });
        throw error;
      }
    }
    return res.status(409).json({ message: 'Could not assign a unique course code. Refresh and try again.' });
  } catch (error) { next(error); }
});

app.get('/api/students', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const department = String(req.query.department || '').trim();
    const semester = parseSemester(req.query.semester);
    if (semester !== null && !Number.isInteger(semester)) return res.status(400).json({ message: 'Semester must be from 1 to 8.' });
    if (department && !BRANCH_BY_NAME[department]) return res.status(400).json({ message: 'Choose a valid branch.' });
    const query = {};
    if (department) query.department = department;
    if (semester) query.semester = semester;
    if (search) query.$or = [
      { studentId: { $regex: escapeRegex(search), $options: 'i' } },
      { name: { $regex: escapeRegex(search), $options: 'i' } },
      { email: { $regex: escapeRegex(search), $options: 'i' } }
    ];
    const students = await getDatabase().collection('students').find(query).sort({ department: 1, semester: 1, studentId: 1 }).toArray();
    res.json(students);
  } catch (error) { next(error); }
});

app.post('/api/students', async (req, res, next) => {
  try {
    const { name, email, department, semester: semesterValue } = req.body;
    const semester = Number(semesterValue);
    if (!validText(name, 120) || !validText(email, 120) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        !BRANCH_BY_NAME[department] || !Number.isInteger(semester) || !SEMESTERS.includes(semester)) {
      return res.status(400).json({ message: 'Enter a valid name and email, then select a branch and semester (1–8).' });
    }
    const students = getDatabase().collection('students');
    const normalizedEmail = email.trim().toLowerCase();
    if (await students.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ message: 'A student with this email already exists.' });
    }

    // The registration number is created server-side and protected by a unique MongoDB index.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const student = {
        studentId: newStudentId(department, semester),
        name: name.trim(),
        email: normalizedEmail,
        department,
        branchCode: BRANCH_BY_NAME[department].code,
        semester,
        marks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        isDemoRecord: false
      };
      try {
        await students.insertOne(student);
        return res.status(201).json({ message: `Student added. Registration number: ${student.studentId}`, student });
      } catch (error) {
        if (error.code === 11000 && error.keyPattern?.email) return res.status(409).json({ message: 'A student with this email already exists.' });
        if (error.code === 11000 && error.keyPattern?.studentId && attempt < 4) continue;
        if (error.code === 11000) return res.status(409).json({ message: 'Could not assign a unique registration number. Please submit again.' });
        throw error;
      }
    }
    return res.status(409).json({ message: 'Could not assign a unique registration number. Please submit again.' });
  } catch (error) { next(error); }
});

app.patch('/api/students/:studentId/marks', async (req, res, next) => {
  try {
    const studentId = String(req.params.studentId).trim().toUpperCase();
    const courseCode = String(req.body.courseCode || '').trim().toUpperCase();
    const marks = Number(req.body.marks);
    if (!validText(courseCode, 30) || !Number.isFinite(marks) || marks < 0 || marks > 100) {
      return res.status(400).json({ message: 'Choose a course and enter marks between 0 and 100.' });
    }
    const db = getDatabase();
    const courses = db.collection('courses');
    const students = db.collection('students');
    const [course, student] = await Promise.all([
      courses.findOne({ courseCode }),
      students.findOne({ studentId })
    ]);
    if (!course) return res.status(404).json({ message: 'Course not found. Refresh the course list.' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (course.department !== student.department || course.semester !== student.semester) {
      return res.status(400).json({ message: `Choose a course from ${student.department}, semester ${student.semester}.` });
    }

    const existingMark = (student.marks || []).find(item => item.courseCode === courseCode);
    if (existingMark) {
      await students.updateOne(
        { studentId, 'marks.courseCode': courseCode },
        { $set: { 'marks.$.marks': marks, updatedAt: new Date() } }
      );
    } else {
      await students.updateOne(
        { studentId },
        { $push: { marks: { courseCode, marks } }, $set: { updatedAt: new Date() } }
      );
    }
    res.json({ message: `Marks saved for ${student.name} in ${course.courseName}.`, studentId, courseCode, marks });
  } catch (error) { next(error); }
});

app.get('/api/performance', async (req, res, next) => {
  try {
    const department = String(req.query.department || '').trim();
    const semester = parseSemester(req.query.semester);
    if (semester !== null && !Number.isInteger(semester)) return res.status(400).json({ message: 'Semester must be from 1 to 8.' });
    if (department && !BRANCH_BY_NAME[department]) return res.status(400).json({ message: 'Choose a valid branch.' });
    const rows = await getDatabase().collection('students').aggregate(coursePerformancePipeline({ department, semester })).toArray();
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/overview', async (req, res, next) => {
  try {
    const db = getDatabase();
    const students = db.collection('students');
    const courses = db.collection('courses');
    const [studentCount, courseCount, overall, performance] = await Promise.all([
      students.countDocuments(),
      courses.countDocuments(),
      students.aggregate([
        { $unwind: '$marks' },
        { $lookup: { from: 'courses', localField: 'marks.courseCode', foreignField: 'courseCode', as: 'course' } },
        { $unwind: '$course' },
        { $match: { $expr: { $and: [
          { $eq: ['$department', '$course.department'] },
          { $eq: ['$semester', '$course.semester'] }
        ] } } },
        { $group: { _id: null, average: { $avg: '$marks.marks' }, total: { $sum: 1 } } }
      ]).toArray(),
      students.aggregate(coursePerformancePipeline()).toArray()
    ]);
    res.json({
      studentCount,
      courseCount,
      averageMarks: overall.length ? Math.round(overall[0].average * 100) / 100 : 0,
      recordedMarks: overall.length ? overall[0].total : 0,
      performance
    });
  } catch (error) { next(error); }
});

app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found.' }));
app.use((error, req, res, next) => {
  console.error(error.message || error);
  if (res.headersSent) return next(error);
  res.status(500).json({ message: 'A server error occurred. Check the terminal for details.' });
});

let server;
connectDatabase().then(() => {
  console.log(`MongoDB connected. Database: ${process.env.DB_NAME || 'StudentPerformance'}`);
  server = app.listen(PORT, () => console.log(`Student Performance System running at http://localhost:${PORT}`));
}).catch(error => {
  console.error('Could not start application:', error.message);
  process.exitCode = 1;
});

async function shutdown() {
  if (server) server.close();
  await closeDatabase();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
