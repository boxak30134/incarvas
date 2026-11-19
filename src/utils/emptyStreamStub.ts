export class Transform {
  pipe<T>(dest: T): T {
    return dest;
  }
  on() {
    return this;
  }
  once() {
    return this;
  }
  emit() {
    return false;
  }
}

export default { Transform };
