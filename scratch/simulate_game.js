import { QUESTIONS } from '../frontend/questions.js';

console.log("Total questions loaded:", QUESTIONS.length);

const TARGET_CORRECT_ANSWERS = 20;
let quizScore = 0;
let quizQueueIdx = 0;
let quizQueue = QUESTIONS.map((_, i) => i); // Sequential or random, let's do sequential

// Simulation loop
while (quizScore < TARGET_CORRECT_ANSWERS) {
    if (quizQueueIdx >= quizQueue.length) {
        console.error("Queue index out of bounds! Length:", quizQueue.length, "Idx:", quizQueueIdx);
        break;
    }

    const qIdx = quizQueue[quizQueueIdx];
    const question = QUESTIONS[qIdx];
    
    if (!question) {
        console.error("Question at index", qIdx, "is undefined!");
        break;
    }

    // Answer correctly
    console.log(`Answering Q${quizQueueIdx + 1} (index ${qIdx}): ${question.question.substring(0, 30)}...`);
    quizScore += 1;
    quizQueueIdx += 1;
}

console.log("Simulation finished successfully! Score:", quizScore, "QueueIdx:", quizQueueIdx);
