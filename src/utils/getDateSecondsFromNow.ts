export const getDateSecondsFromNow = (seconds: number) => {
  const date = new Date();
  date.setSeconds(date.getSeconds() + seconds);
  return date;
};
