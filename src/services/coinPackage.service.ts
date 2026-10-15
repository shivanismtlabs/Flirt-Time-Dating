import { Op, Order } from 'sequelize';
import { CoinPackage } from '../models/coinPackage.model';
import { GetCoinPackagesQuery } from '../schemas/coinPackage.schema';

export interface FormattedCoinPackageDTO {
  id: number;
  name: string;
  price: string;
  currency: string;
  coins: number;
  bonus_coins: number;
  google_product_id: string | null;
  apple_product_id?: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CoinPackagesPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface CoinPackagesListResult {
  data: FormattedCoinPackageDTO[];
  pagination: CoinPackagesPaginationMeta;
}

export class CoinPackageServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'CoinPackageServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, CoinPackageServiceError.prototype);
  }
}

export class CoinPackageService {
  /**
   * Formats a raw database CoinPackage record into exact Laravel response DTO
   */
  public formatPackage(pkg: CoinPackage): FormattedCoinPackageDTO {
    const rawPrice = pkg.getDataValue('price');
    let formattedPrice: string;
    if (typeof rawPrice === 'number') {
      formattedPrice = rawPrice.toFixed(2);
    } else if (typeof rawPrice === 'string' && !isNaN(parseFloat(rawPrice))) {
      formattedPrice = parseFloat(rawPrice).toFixed(2);
    } else {
      formattedPrice = String(rawPrice || '0.00');
    }

    const dto: FormattedCoinPackageDTO = {
      id: pkg.id,
      name: pkg.name,
      price: formattedPrice,
      currency: pkg.currency || 'INR',
      coins: Number(pkg.coins),
      bonus_coins: Number(pkg.bonus_coins || 0),
      google_product_id: pkg.google_product_id || null,
      is_active: Boolean(pkg.is_active),
      sort_order: Number(pkg.sort_order || 0),
      created_at: pkg.created_at ? new Date(pkg.created_at).toISOString() : new Date().toISOString(),
      updated_at: pkg.updated_at ? new Date(pkg.updated_at).toISOString() : new Date().toISOString(),
    };

    if (pkg.apple_product_id !== undefined) {
      dto.apple_product_id = pkg.apple_product_id || null;
    }

    return dto;
  }

  /**
   * Retrieves active coin packages matching filters, sorting, and pagination
   */
  public async getCoinPackages(query: GetCoinPackagesQuery): Promise<CoinPackagesListResult> {
    const page = Math.max(1, parseInt(String(query.page || 1), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(query.limit || 10), 10)));
    const sortBy = query.sortBy || 'sort_order';
    const sortOrder = (query.sortOrder ? String(query.sortOrder).toUpperCase() : 'ASC') as 'ASC' | 'DESC';
    const minPrice = query.minPrice !== undefined ? parseFloat(String(query.minPrice)) : undefined;
    const maxPrice = query.maxPrice !== undefined ? parseFloat(String(query.maxPrice)) : undefined;
    const minCoins = query.minCoins !== undefined ? parseInt(String(query.minCoins), 10) : undefined;
    const maxCoins = query.maxCoins !== undefined ? parseInt(String(query.maxCoins), 10) : undefined;

    // 1. Base Where Clause - active packages only
    const where: any = {
      is_active: true,
    };

    // 2. Decimal-safe Price Filtering (handled in SQL engine)
    if (minPrice !== undefined && maxPrice !== undefined) {
      where.price = { [Op.between]: [minPrice, maxPrice] };
    } else if (minPrice !== undefined) {
      where.price = { [Op.gte]: minPrice };
    } else if (maxPrice !== undefined) {
      where.price = { [Op.lte]: maxPrice };
    }

    // 3. Integer Coin Amount Filtering
    if (minCoins !== undefined && maxCoins !== undefined) {
      where.coins = { [Op.between]: [minCoins, maxCoins] };
    } else if (minCoins !== undefined) {
      where.coins = { [Op.gte]: minCoins };
    } else if (maxCoins !== undefined) {
      where.coins = { [Op.lte]: maxCoins };
    }

    // 4. Stable Parameterized Sorting
    const order: Order = [];
    if (sortBy === 'sort_order') {
      order.push(['sort_order', sortOrder]);
      order.push(['id', 'ASC']);
    } else if (sortBy === 'price') {
      order.push(['price', sortOrder]);
      order.push(['id', 'ASC']);
    } else if (sortBy === 'coins') {
      order.push(['coins', sortOrder]);
      order.push(['id', 'ASC']);
    } else if (sortBy === 'name') {
      order.push(['name', sortOrder]);
      order.push(['id', 'ASC']);
    } else {
      order.push(['id', sortOrder]);
    }

    // 5. Database Pagination before returning
    const offset = (page - 1) * limit;

    const { count, rows } = await CoinPackage.findAndCountAll({
      where,
      order,
      limit,
      offset,
      distinct: true,
    });

    const totalPages = Math.ceil(count / limit) || (count === 0 ? 0 : 1);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    const data = rows.map((pkg) => this.formatPackage(pkg));

    return {
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      },
    };
  }
}

export const coinPackageService = new CoinPackageService();
