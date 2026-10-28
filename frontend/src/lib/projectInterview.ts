// Question depth changes with experience; project facts always come from supplied evidence.
export function projectTechnicalQuestion(label: string, summary: string, role: string, years: number, slot: number, seed = '', lastAnswer = '') {
  const evidence = summary + ' ' + (slot === 2 ? lastAnswer : '');
  const kind = /pipeline|etl|spark|airflow|warehouse/i.test(evidence) ? 'pipeline'
    : /api|endpoint|authentication|backend/i.test(evidence) ? 'api'
    : /react|frontend|front.end|interface|web page/i.test(evidence) ? 'ui'
    : /model|machine learning|prediction|classifier/i.test(evidence) ? 'ml' : 'general';
  const junior = years < 2;
  const senior = years >= 5;
  const scope = label ? 'the project “' + label.slice(0, 95) + '”' : 'a project from your background';
  const implementation = {
    pipeline: junior ? 'how did you move data through the part you built' : senior ? 'why did you choose the way data is split and processed' : 'how did you handle data that arrived late or in the wrong format',
    api: junior ? 'how did you handle a request and send back a response' : senior ? 'how did you decide where to check access to data' : 'how did you handle failed requests without losing data',
    ui: junior ? 'how did you connect a user action to a screen update' : senior ? 'how did you decide which parts of the interface should share state' : 'how did you keep the screen in sync with data from the server',
    ml: junior ? 'how did you prepare the data for the model' : senior ? 'how did you decide whether the model was ready to use' : 'how did you keep training data separate from test data',
    general: junior ? 'how did you build or carry out the part you worked on' : senior ? 'why did you choose your approach over another option' : 'how did you handle a difficult part of the implementation',
  };
  const followUps = junior
    ? [kind === 'pipeline' ? 'how did you test the pipeline with missing or repeated data' : kind === 'api' ? 'how did you test the API with an invalid request' : kind === 'ui' ? 'how did you test that a user action updated the correct part of the screen' : kind === 'ml' ? 'how did you test the model with data it had not seen before' : 'how did you test your part with an input that might cause an error', 'how did you find the cause when your part did not work as expected']
    : senior
      ? ['what design change would make the project more reliable, and why', 'how would you check whether your main design choice still works at a much larger scale']
      : ['how did you find the cause of a failure in your part', 'how did you test that your change worked without breaking another part'];
  let hash = 0; for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const question = slot === 1 ? implementation[kind] : followUps[hash % followUps.length];
  return slot === 1 ? 'As a ' + role + ', for ' + scope + ', ' + question + '?'
    : 'Going deeper into ' + scope + ', ' + question + '?';
}
