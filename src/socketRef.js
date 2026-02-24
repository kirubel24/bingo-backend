let ioRef = null;

export const setIo = (io) => {
  ioRef = io;
};

export const getIo = () => ioRef;