import { publicQuizMeta, publicQuizQuestions } from './public-quiz-data.ts';

export type ScoreMode = 'practice' | 'formal';
export type FeedbackPolicy =
  | 'immediate'
  | 'class-closed'
  | 'all-closed'
  | 'teacher-release';

export type RubricUnit = {
  label: string;
  points: number;
  requirement: string;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  segmentedAnswer: string;
  hint: string;
  rubric: RubricUnit[];
  acceptedAlternatives: string[];
  scoredAlternatives?: Array<{
    answer: string;
    score: number;
    reason: string;
  }>;
};

export const quizMeta = {
  ...publicQuizMeta,
  rubricVersion: 'rubric-v2',
};

export const quizQuestions: QuizQuestion[] = [
  {
    id: 'Q1',
    prompt: publicQuizQuestions[0].prompt,
    segmentedAnswer: 'Mia, / what time did you get / to school / this morning?',
    hint: '詢問過去發生的時間，用 What time did you...？did 後面的動詞用原形。',
    rubric: [
      { label: '稱呼語', points: 2, requirement: '包含 Mia' },
      { label: '過去時間問句', points: 10, requirement: '表達 What time did you get/arrive' },
      { label: '地點與時間', points: 6, requirement: '包含 to school 與 this morning' },
      { label: '書寫規約', points: 2, requirement: '句首大寫、逗號與句尾問號' },
    ],
    acceptedAlternatives: ['What time did you arrive at school this morning, Mia?'],
  },
  {
    id: 'Q2',
    prompt: publicQuizQuestions[1].prompt,
    segmentedAnswer: 'I got to school / at seven thirty / with my brother.',
    hint: 'get 的過去式是 got；「和……一起」用 with。',
    rubric: [
      { label: '主詞與過去式', points: 6, requirement: '使用 I got/arrived' },
      { label: '時間', points: 6, requirement: '表達 at seven thirty / at 7:30' },
      { label: '同伴', points: 6, requirement: '表達 with my brother' },
      { label: '書寫規約', points: 2, requirement: '句首大寫與句點' },
    ],
    acceptedAlternatives: ['I arrived at school at 7:30 with my brother.'],
  },
  {
    id: 'Q3',
    prompt: publicQuizQuestions[2].prompt,
    segmentedAnswer: 'What is / your first class?',
    hint: '詢問「是什麼」用 What is...？first 表示「第一」。',
    rubric: [
      { label: '問句', points: 8, requirement: '使用 What is / What\'s' },
      { label: '主題', points: 10, requirement: '包含 your first class' },
      { label: '書寫規約', points: 2, requirement: '句首大寫與問號' },
    ],
    acceptedAlternatives: ["What's your first class?"],
  },
  {
    id: 'Q4',
    prompt: publicQuizQuestions[3].prompt,
    segmentedAnswer: 'My first class is math, / but I forgot / to bring my textbook.',
    hint: 'forget 的過去式是 forgot；「忘了做某事」用 forget to + 原形動詞。',
    rubric: [
      { label: '第一堂課', points: 6, requirement: '表達 My first class is math' },
      { label: '轉折', points: 3, requirement: '使用 but 連接兩個意思' },
      { label: '忘了帶', points: 9, requirement: '表達 I forgot to bring my textbook/book' },
      { label: '書寫規約', points: 2, requirement: '句首大寫、but 前逗號與句點' },
    ],
    acceptedAlternatives: ["It's math, but I forgot to bring my textbook."],
  },
  {
    id: 'Q5',
    prompt: publicQuizQuestions[4].prompt,
    segmentedAnswer: 'That\'s too bad!',
    hint: '表達同情的常見說法是 That\'s too bad!，結尾用驚嘆號。',
    rubric: [
      { label: '口語說法', points: 8, requirement: '使用 That\'s too bad 表達「真糟糕」' },
      { label: '書寫規約', points: 2, requirement: '句首大寫與驚嘆號' },
    ],
    acceptedAlternatives: ['That is too bad!'],
    scoredAlternatives: [
      { answer: 'Oh no!', score: 5, reason: '語氣正確，但未使用目標說法 That\'s too bad。' },
    ],
  },
];
