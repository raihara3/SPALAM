/**
 * 軽量サービスコンテナ
 * 依存性注入の基本機能のみを提供
 */
export class ServiceContainer {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();

  /**
   * サービスインスタンスを登録
   */
  register<T>(name: string, instance: T): void {
    this.services.set(name, instance);
  }

  /**
   * ファクトリ関数を登録
   */
  registerFactory<T>(name: string, factory: () => T): void {
    this.factories.set(name, factory);
  }

  /**
   * サービスを解決
   */
  resolve<T>(name: string): T {
    // 既存のインスタンスがあれば返す
    if (this.services.has(name)) {
      return this.services.get(name) as T;
    }

    // ファクトリがあれば実行してインスタンスを作成
    if (this.factories.has(name)) {
      const factory = this.factories.get(name)!;
      const instance = factory();
      this.services.set(name, instance);
      return instance as T;
    }

    throw new Error(`Service not found: ${name}`);
  }

  /**
   * サービスが登録されているかチェック
   */
  has(name: string): boolean {
    return this.services.has(name) || this.factories.has(name);
  }

  /**
   * サービスを削除
   */
  remove(name: string): void {
    this.services.delete(name);
    this.factories.delete(name);
  }

  /**
   * すべてのサービスをクリア
   */
  clear(): void {
    this.services.clear();
    this.factories.clear();
  }
}

/**
 * グローバルサービスコンテナ
 */
export const globalContainer = new ServiceContainer();