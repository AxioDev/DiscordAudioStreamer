let threePromise = null;

export const loadThree = async () => {
  if (!threePromise) {
    threePromise = import('three')
      .then((module) => module)
      .catch((error) => {
        threePromise = null;
        throw error;
      });
  }
  return threePromise;
};
