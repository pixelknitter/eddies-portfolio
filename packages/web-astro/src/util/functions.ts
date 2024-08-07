/**
 * Utility functions
 */

export const sentenceCase = (str: string) => {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const readableHostname = (hostname: string): string | undefined =>  {
  const hostArray = hostname.split('.');

  let subName: string | undefined = undefined

  if(hostArray.length > 2) {
    // get the first element of the array
    subName = hostArray.shift();
    console.info('readableHostname - subName',subName)
  }

  switch(hostArray[hostArray.length - 1]) {
    case 'engineering':
      // inject "by" in the middle and reverse the array
      hostArray.splice(1, 0, 'by');
      hostArray.reverse();
      break;
    case 'codes':
      // add "eddie" to the front
      hostArray.unshift('eddie');
      break;
    default:
      return undefined;
  }
  const readable = `${sentenceCase(hostArray.join(' '))}${subName ? ` | ${subName}` : ''}`;
  console.info('readableHostname - result',readable)

  return readable;
}