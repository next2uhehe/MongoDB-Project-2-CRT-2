const test = require('node:test');
const assert = require('node:assert/strict');
const { BRANCHES, SEMESTERS, BRANCH_BY_NAME, buildCurriculum, newStudentId } = require('../curriculum');

test('each supported branch has courses for semesters 1 through 8', () => {
  const courses = buildCurriculum();
  for (const branch of BRANCHES) {
    for (const semester of SEMESTERS) {
      assert.ok(courses.some(course => course.department === branch.name && course.semester === semester), `${branch.name} semester ${semester}`);
    }
  }
});

test('course codes are unique and encode the branch code and semester', () => {
  const courses = buildCurriculum();
  const codes = courses.map(course => course.courseCode);
  assert.equal(new Set(codes).size, codes.length, 'course codes must be unique');
  for (const course of courses) {
    const branch = BRANCH_BY_NAME[course.department];
    assert.match(course.courseCode, new RegExp(`^${branch.code}${course.semester}\\d{2}$`));
  }
});

test('the same subject is not reused across semesters within a branch', () => {
  const courses = buildCurriculum();
  for (const branch of BRANCHES) {
    const names = courses.filter(course => course.department === branch.name).map(course => course.courseName.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${branch.name} has a subject repeated across semesters`);
  }
});

test('AI & Data Science semesters 3 and 5 have different subject lists and codes', () => {
  const courses = buildCurriculum().filter(course => course.department === 'AI & Data Science');
  const third = courses.filter(course => course.semester === 3);
  const fifth = courses.filter(course => course.semester === 5);
  assert.ok(third.every(course => course.courseCode.startsWith('AD3')));
  assert.ok(fifth.every(course => course.courseCode.startsWith('AD5')));
  assert.equal(third.some(course => fifth.some(other => other.courseName === course.courseName)), false);
});

test('generated registration numbers encode the selected branch and semester', () => {
  const ids = Array.from({ length: 100 }, () => newStudentId('AI & Data Science', 3));
  assert.ok(ids.every(id => /^AD3-\d{2}-[A-F0-9]{6}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length, 'sample generated IDs should not collide');
  assert.match(newStudentId('Information Technology', 5), /^IT5-\d{2}-[A-F0-9]{6}$/);
});
