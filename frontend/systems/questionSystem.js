import { QUESTIONS } from '../questions.js';

export class QuestionSystem {
    constructor(questions = QUESTIONS) {
        this.questions = questions;
    }

    getQuestionByIndex(index) {
        if (index >= 0 && index < this.questions.length) {
            return this.questions[index];
        }
        return null;
    }

    verifyAnswer(questionIdx, selectedOptionIdx) {
        const q = this.getQuestionByIndex(questionIdx);
        if (!q) return false;
        return q.answer === selectedOptionIdx;
    }

    getExplanation(questionIdx) {
        const q = this.getQuestionByIndex(questionIdx);
        if (!q) return "";
        return q.explanation || "";
    }

    getChapter(questionIdx) {
        const q = this.getQuestionByIndex(questionIdx);
        if (!q) return "";
        return q.chapter || "";
    }
}
