/** the whole library + the skillset: a lesson a week stays small enough to hand over at once */
export default defineEventHandler(() => ({ lessons: listLessons(), skills: listSkills(), today: berlinDay(), week: lessonWeek(), next: nextWeek() }))
