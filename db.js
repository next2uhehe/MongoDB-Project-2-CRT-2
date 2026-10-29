const { MongoClient } = require('mongodb');
const { BRANCH_BY_NAME, buildCurriculum, newStudentId } = require('./curriculum');

let client;
let database;

const sampleStudents = [
  { name: 'Aarav Sharma', email: 'aarav@example.com', department: 'AI & Data Science', semester: 5, scores: [86, 91, 78, 88, 84] },
  { name: 'Diya Singh', email: 'diya@example.com', department: 'AI & Data Science', semester: 5, scores: [94, 89, 92, 85, 90] },
  { name: 'Kabir Verma', email: 'kabir@example.com', department: 'AI & Data Science', semester: 5, scores: [73, 81, 76, 80, 78] },
  { name: 'Ananya Gupta', email: 'ananya@example.com', department: 'AI & Data Science', semester: 5, scores: [88, 95, 90, 93, 91] },
  { name: 'Ishaan Mehta', email: 'ishaan@example.com', department: 'AI & Data Science', semester: 5, scores: [69, 74, 71, 77, 75] },
  { name: 'Meera Joshi', email: 'meera@example.com', department: 'AI & Data Science', semester: 5, scores: [90, 87, 95, 89, 94] },
  { name: 'Riya Kapoor', email: 'demo.ad1@example.com', department: 'AI & Data Science', semester: 1, scores: [82, 88, 79, 91] },
  { name: 'Arjun Malhotra', email: 'demo.ad2@example.com', department: 'AI & Data Science', semester: 2, scores: [78, 84, 90, 81] },
  { name: 'Sara Khan', email: 'demo.ad3@example.com', department: 'AI & Data Science', semester: 3, scores: [91, 85, 88, 92] },
  { name: 'Vivaan Rao', email: 'demo.ad4@example.com', department: 'AI & Data Science', semester: 4, scores: [76, 83, 80, 87] },
  { name: 'Aditi Bansal', email: 'demo.ad6@example.com', department: 'AI & Data Science', semester: 6, scores: [90, 86, 93, 88] },
  { name: 'Reyansh Jain', email: 'demo.ad7@example.com', department: 'AI & Data Science', semester: 7, scores: [84, 89, 91, 86] },
  { name: 'Myra Sethi', email: 'demo.ad8@example.com', department: 'AI & Data Science', semester: 8, scores: [93, 90, 88, 95] },
  { name: 'Dev Patel', email: 'demo.cs3@example.com', department: 'Computer Science & Engineering', semester: 3, scores: [82, 79, 87, 90] },
  { name: 'Ira Choudhary', email: 'demo.it5@example.com', department: 'Information Technology', semester: 5, scores: [88, 91, 85, 90, 86] },
  { name: 'Nikhil Yadav', email: 'demo.ec5@example.com', department: 'Electronics & Communication Engineering', semester: 5, scores: [77, 83, 80, 85, 78] },
  { name: 'Pooja Rathore', email: 'demo.ee3@example.com', department: 'Electrical Engineering', semester: 3, scores: [86, 89, 81, 84] },
  { name: 'Manav Shekhawat', email: 'demo.me5@example.com', department: 'Mechanical Engineering', semester: 5, scores: [80, 84, 88, 82, 86] },
  { name: 'Kavya Sharma', email: 'demo.ce3@example.com', department: 'Civil Engineering', semester: 3, scores: [91, 85, 88, 89] },
  { name: 'Aditya Mishra', email: 'demo.co5@example.com', department: 'Computer Engineering', semester: 5, scores: [84, 87, 90, 82, 88] }
];

async function migrateLegacyRecords(students, courses) {
  // Preserve existing marks while moving every old AID3xx/AID5xx-style code
  // to the new AD3xx/AD5xx convention, including extra courses added by users.
  // Match subjects by name rather than by old number so (for example) an old
  // Software Engineering mark never becomes a Data Visualization mark.
  const coreCourses = buildCurriculum();
  const coreBySubject = new Map(coreCourses.map(course => [
    `${course.department}|${course.semester}|${course.courseName.trim().toLowerCase()}`,
    course
  ]));
  const existingCodes = new Set((await courses.find({}).project({ courseCode: 1 }).toArray()).map(item => String(item.courseCode).toUpperCase()));
  for (const course of coreCourses) existingCodes.add(course.courseCode);

  const legacyCourses = await courses.find({ courseCode: /^AID[1-8]\d{2}$/i }).toArray();
  for (const oldCourse of legacyCourses) {
    const oldCode = oldCourse.courseCode;
    const dept = BRANCH_BY_NAME[oldCourse.department] ? oldCourse.department : 'AI & Data Science';
    const branch = BRANCH_BY_NAME[dept];
    const semesterFromCode = Number(String(oldCode).toUpperCase().slice(3, 4));
    const semester = Number.isInteger(Number(oldCourse.semester)) && Number(oldCourse.semester) >= 1 && Number(oldCourse.semester) <= 8
      ? Number(oldCourse.semester) : semesterFromCode;
    const coreMatch = coreBySubject.get(`${dept}|${semester}|${String(oldCourse.courseName || '').trim().toLowerCase()}`);
    let newCode = coreMatch?.courseCode;

    if (!newCode) {
      const prefix = `${branch.code}${semester}`;
      for (let sequence = 1; sequence <= 99; sequence += 1) {
        const candidate = `${prefix}${String(sequence).padStart(2, '0')}`;
        if (!existingCodes.has(candidate)) { newCode = candidate; break; }
      }
      if (!newCode) throw new Error(`Could not migrate legacy course ${oldCode}: no code is available.`);
    }

    await students.updateMany(
      { 'marks.courseCode': oldCode },
      { $set: { 'marks.$[mark].courseCode': newCode, updatedAt: new Date() } },
      { arrayFilters: [{ 'mark.courseCode': oldCode }] }
    );

    const targetCourse = await courses.findOne({ courseCode: newCode });
    if (targetCourse) {
      await courses.deleteOne({ courseCode: oldCode });
    } else {
      const migratedName = coreMatch ? coreMatch.courseName : `${oldCourse.courseName || 'Legacy subject'} (Legacy Record)`;
      await courses.updateOne({ courseCode: oldCode }, { $set: {
        courseCode: newCode,
        courseName: migratedName,
        department: dept,
        branchCode: branch.code,
        semester,
        credits: coreMatch?.credits || oldCourse.credits || 3,
        isCoreCurriculum: Boolean(coreMatch),
        isLegacyRecord: !coreMatch
      } });
    }
    existingCodes.add(newCode);
  }

  // Backfill branch codes for records from the first project version.
  const existingStudents = await students.find({}).toArray();
  for (const student of existingStudents) {
    const branch = BRANCH_BY_NAME[student.department];
    if (branch && student.branchCode !== branch.code) {
      await students.updateOne({ _id: student._id }, { $set: { branchCode: branch.code } });
    }
  }

  // Convert old, manually entered IDs to the new branch/semester format.
  // Already generated IDs match e.g. AD5-26-A1B2C3 and are kept unchanged.
  const legacyStudents = await students.find({ studentId: { $not: /^[A-Z]{2}[1-8]-\d{2}-[A-F0-9]{6}$/i } }).toArray();
  for (const student of legacyStudents) {
    // Avoid guessing the branch for records created with an unsupported free-text department.
    const department = BRANCH_BY_NAME[student.department] ? student.department : null;
    if (!department) continue;
    const semester = Number.isInteger(Number(student.semester)) && Number(student.semester) >= 1 && Number(student.semester) <= 8
      ? Number(student.semester) : 5;
    let updated = false;
    for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
      try {
        await students.updateOne({ _id: student._id }, { $set: { studentId: newStudentId(department, semester), department, branchCode: BRANCH_BY_NAME[department].code, semester } });
        updated = true;
      } catch (error) {
        if (error.code !== 11000 || attempt === 4) throw error;
      }
    }
  }
}

async function seedCurriculum(courses) {
  const now = new Date();
  const operations = buildCurriculum().map(course => ({
    updateOne: {
      filter: { courseCode: course.courseCode },
      update: { $set: { ...course, updatedAt: now }, $setOnInsert: { createdAt: now } },
      upsert: true
    }
  }));
  if (operations.length) await courses.bulkWrite(operations, { ordered: false });
}

async function seedSampleStudents(students, courses) {
  const allCourses = await courses.find({}).sort({ courseCode: 1 }).toArray();
  const courseMap = new Map();
  for (const course of allCourses) {
    const key = `${course.department}|${course.semester}`;
    if (!courseMap.has(key)) courseMap.set(key, []);
    courseMap.get(key).push(course);
  }
  const now = new Date();
  const operations = sampleStudents.map(sample => {
    const branch = BRANCH_BY_NAME[sample.department];
    const courseList = courseMap.get(`${sample.department}|${sample.semester}`) || [];
    const marks = courseList.map((course, index) => ({ courseCode: course.courseCode, marks: sample.scores[index % sample.scores.length] }));
    return {
      updateOne: {
        filter: { email: sample.email },
        update: { $setOnInsert: {
          studentId: newStudentId(sample.department, sample.semester),
          name: sample.name,
          email: sample.email,
          department: sample.department,
          branchCode: branch.code,
          semester: sample.semester,
          marks,
          createdAt: now,
          updatedAt: now,
          isDemoRecord: true
        } },
        upsert: true
      }
    };
  });
  if (operations.length) await students.bulkWrite(operations, { ordered: false });
}

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is missing. Create a .env file using .env.example.');

  client = new MongoClient(uri);
  await client.connect();
  database = client.db(process.env.DB_NAME || 'StudentPerformance');

  const students = database.collection('students');
  const courses = database.collection('courses');

  await students.createIndex({ studentId: 1 }, { unique: true });
  await students.createIndex({ email: 1 }, { unique: true });
  await students.createIndex({ department: 1, semester: 1 });
  await students.createIndex({ 'marks.courseCode': 1 });
  await courses.createIndex({ courseCode: 1 }, { unique: true });
  await courses.createIndex({ department: 1, semester: 1 });
  await courses.createIndex({ department: 1, semester: 1, courseName: 1 });

  await migrateLegacyRecords(students, courses);
  await seedCurriculum(courses);
  await seedSampleStudents(students, courses);
  return database;
}

function getDatabase() {
  if (!database) throw new Error('Database connection has not been initialized.');
  return database;
}

async function closeDatabase() {
  if (client) await client.close();
}

module.exports = { connectDatabase, getDatabase, closeDatabase, newStudentId };
