// static/camera/analysis.js

export function getEmotion(blend) {
    if (!blend) return "neutral";

    const scores = {};
    blend.forEach(b => scores[b.categoryName] = b.score);

    const mapping = {
        happy: ["mouthSmileLeft", "mouthSmileRight"], 
        sad: ["mouthFrownLeft", "mouthFrownRight", "browInnerUp"],
        angry: ["browDownLeft", "browDownRight"],
        surprise: ["eyeWideLeft", "eyeWideRight", "jawOpen", "browOuterUpLeft"], 
        fear: ["browInnerUp", "eyeWideLeft", "eyeWideRight"],
        disgust: ["noseSneerLeft", "noseSneerRight", "mouthUpperUpLeft"]
    };

    let best = "neutral", bestScore = 0;

    for (const emo in mapping) {
        let total = 0;
        mapping[emo].forEach(k => {
            if (scores[k]) total += scores[k];
        });
        
        let avg = total / mapping[emo].length;

        // PRIORITIZE HAPPINESS: 
        // If smile is detected, it usually overrides other subtle movements
        if (emo === "happy" && avg > 0.3) {
            return "happy";
        }

        if (avg > bestScore) {
            bestScore = avg;
            best = emo;
        }
    }

    // Threshold lowered to 0.15 to catch subtle expressions
    return bestScore < 0.15 ? "neutral" : best;
}

export function getAUs(blend) {
    if (!blend) return [];

    const scores = {};
    blend.forEach(b => scores[b.categoryName] = b.score);

    // Mapped specifically to the muscles seen in your logs
    const AUMap = {
        "Lip Corner Puller (Smile)": ["mouthSmileLeft", "mouthSmileRight"],
        "Upper Lip Raiser": ["mouthUpperUpLeft", "mouthUpperUpRight"], 
        "Looking Down": ["eyeLookDownLeft", "eyeLookDownRight"], // ADDED THIS FOR YOU
        "Brow Inner Raiser": ["browInnerUp"],
        "Brow Outer Raiser": ["browOuterUpLeft", "browOuterUpRight"],
        "Blink": ["eyeBlinkLeft", "eyeBlinkRight"],
        "Lip Corner Depressor": ["mouthFrownLeft", "mouthFrownRight"],
        "Lip Tightener": ["mouthPucker"], 
        "Lip Pressor": ["mouthPressLeft", "mouthPressRight"],
        "Lid Tightener": ["eyeSquintLeft", "eyeSquintRight"],
        "Chin Raiser": ["mouthShrugLower"],
        "Brow Lowerer": ["browDownLeft", "browDownRight"],
        "Cheek Raiser": ["cheekSquintLeft", "cheekSquintRight"],
        "Jaw Drop": ["jawOpen"]
    };

    const result = [];

    for (const AU in AUMap) {
        let totalScore = 0;
        AUMap[AU].forEach(k => totalScore += scores[k] || 0);
        
        // Threshold set to 0.2 based on your logs
        if (totalScore > 0.2) {
            result.push(AU);
        }
    }

    return result;
}