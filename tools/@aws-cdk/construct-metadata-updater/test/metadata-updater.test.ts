import { ConstructsUpdater, EnumLikeUpdater, PropertyUpdater } from '../lib/metadata-updater';
import { Project, ClassDeclaration, SourceFile, QuoteKind, IndentationText } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

// Mock ts-morph
jest.mock('ts-morph');
// Mock fs
jest.mock('fs');
// Mock path
jest.mock('path');

describe('ResourceMetadataUpdater', () => {
  let updater: ConstructsUpdater;
  let mockSourceFile: jest.Mocked<SourceFile>;
  let mockClassDeclaration: jest.Mocked<ClassDeclaration>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock implementations
    (Project as jest.Mock).mockImplementation(() => ({
      addSourceFilesAtPaths: jest.fn(),
      getSourceFiles: jest.fn().mockReturnValue([]),
    }));

    // Mock fs.readdirSync and fs.statSync
    (fs.readdirSync as jest.Mock).mockReturnValue([]);
    (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

    // Mock path.resolve
    (path.resolve as jest.Mock).mockImplementation((...args) => args.join('/'));

    // Create instance of updater
    updater = new ConstructsUpdater('./test-dir');
  });

  describe('constructor', () => {
    it('should initialize with correct project settings', () => {
      expect(Project).toHaveBeenCalledWith({
        tsConfigFilePath: expect.stringMatching(/tsconfig\.json$/),
        manipulationSettings: {
          indentationText: IndentationText.TwoSpaces,
          quoteKind: QuoteKind.Single
        }
      });
    });
  });

  describe('readTypescriptFiles', () => {
    it('should skip specified directories', () => {
      const mockFiles = ['node_modules', 'dist', 'test', 'valid.ts'];
      (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
      (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
      (fs.statSync as jest.Mock).mockImplementation((path) => ({
        isDirectory: () => !path.endsWith('.ts')
      }));

      const result = (updater as any).readTypescriptFiles('./test-dir');
      expect(result).toEqual(['./test-dir/valid.ts']);
    });

    it('should only include valid typescript files', () => {
      const mockFiles = ['file.ts', 'file.generated.ts', 'file.d.ts', 'file.test.ts'];
      (fs.readdirSync as jest.Mock).mockReturnValue(mockFiles);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

      const result = (updater as any).readTypescriptFiles('./test-dir');
      expect(result).toEqual(['./test-dir/file.ts']);
    });
  });

  describe('isDescendantOfResource', () => {
    it('should return true for direct Resource type', () => {
      const mockType = {
        getSymbol: () => ({ getName: () => 'Resource' })
      };

      const result = (updater as any).isDescendantOfResource(mockType);
      expect(result).toBe(true);
    });

    it('should return true for descendant of Resource', () => {
      const mockType = {
        getSymbol: () => ({ getName: () => 'NotResource' }),
        getBaseTypes: () => [{
          getSymbol: () => ({ getName: () => 'Resource' })
        }]
      };

      const result = (updater as any).isDescendantOfResource(mockType);
      expect(result).toBe(true);
    });

    it('should return false for non-Resource type', () => {
      const mockType = {
        getSymbol: () => ({ getName: () => 'NotResource' }),
        getBaseTypes: () => []
      };

      const result = (updater as any).isDescendantOfResource(mockType);
      expect(result).toBe(false);
    });
  });

  describe('getCdkResourceClasses', () => {
    beforeEach(() => {
      mockClassDeclaration = {
        getSymbol: jest.fn().mockReturnValue({ getName: () => 'TestClass', getFullyQualifiedName: () => 'test.TestClass', }),
        getModifiers: jest.fn().mockReturnValue([]),
        getType: jest.fn(),
        getName: jest.fn().mockReturnValue('TestClass'),
        getConstructors: jest.fn().mockReturnValue([]),
      } as any;

      Object.setPrototypeOf(mockClassDeclaration, ClassDeclaration.prototype);

      mockSourceFile = {
        forEachChild: jest.fn((callback) => callback(mockClassDeclaration)),
        getImportDeclarations: jest.fn().mockReturnValue([]),
        addImportDeclaration: jest.fn(),
        saveSync: jest.fn()
      } as any;

      (Project as jest.Mock).mockImplementation(() => ({
        addSourceFilesAtPaths: jest.fn(),
        getSourceFile: jest.fn().mockReturnValue(mockSourceFile)
      }));

      updater = new ConstructsUpdater('./test-dir');
      (updater as any).isDescendantOfResource = jest.fn();
    });

    it('should skip abstract classes', () => {
      mockClassDeclaration.getModifiers.mockReturnValue([{ getText: () => 'abstract' } as any]);
      (updater as any).getCdkResourceClasses('test.ts');
      expect(mockClassDeclaration.getType).not.toHaveBeenCalled();
    });

    it('should process non-abstract Resource classes', () => {
      mockClassDeclaration.getType.mockReturnValue({
        getSymbol: () => ({ getName: () => 'Resource' }),
        getBaseTypes: () => []
      } as any);

      (updater as any).getCdkResourceClasses('test.ts');
      expect((updater as any).isDescendantOfResource).toHaveBeenCalled();
    });
  });

  describe('addLineInConstructor', () => {
    it('should not add metadata if constructor has less than 3 parameters', () => {
      const mockConstructor = {
        getParameters: jest.fn().mockReturnValue([1, 2]),
        getStatements: jest.fn().mockReturnValue([])
      };

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('TestClass'),
        getConstructors: jest.fn().mockReturnValue([mockConstructor])
      } as any;

      const result = (updater as any).addLineInConstructor(mockSourceFile, mockClassDeclaration);
      expect(result).toBe(false);
    });

    it('should add metadata statement after super() call', () => {
      const mockStatements = [{ getText: () => 'super(scope, id);' }];
      const mockConstructor = {
        getParameters: jest.fn().mockReturnValue([1, 2, { getName: () => 'prop' }]),
        getStatements: jest.fn().mockReturnValue(mockStatements),
        insertStatements: jest.fn()
      };

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('TestClass'),
        getConstructors: jest.fn().mockReturnValue([mockConstructor])
      } as any;

      const result = (updater as any).addLineInConstructor(mockSourceFile, mockClassDeclaration);
      expect(result).toBe(true);
      expect(mockConstructor.insertStatements).toHaveBeenCalled();
    });
  });

  describe('filePathToInjectionId', () => {
    it('should return successfully', () => {
      // GIVEN
      const filePath = '/local/home/user/cdk/aws-cdk/packages/aws-cdk-lib/aws-apigateway/lib/api-key.ts';
      const className = 'ApiKey';

      // WHEN
      const injectionId = (updater as any).filePathToInjectionId(filePath, className);

      // THEN
      expect(injectionId).toEqual("'aws-cdk-lib.aws-apigateway.ApiKey'");
    });

    it('should return successfully for alpha', () => {
      // GIVEN
      const filePath = '/local/home/user/cdk/aws-cdk/packages/@aws-cdk/aws-amplify-alpha/lib/app.ts';
      const className = 'App';

      // WHEN
      const injectionId = (updater as any).filePathToInjectionId(filePath, className);

      // THEN
      expect(injectionId).toEqual("'@aws-cdk.aws-amplify-alpha.App'");
    });

    // We should never get an L2 Construct in awslint, but filePathToInjectionId will still work.
    it('should return successfully for awslint', () => {
      // GIVEN
      const filePath = '/local/home/user/cdk/aws-cdk/packages/awslint/lib/app.ts';
      const className = 'App';

      // WHEN
      const injectionId = (updater as any).filePathToInjectionId(filePath, className);

      // THEN
      expect(injectionId).toEqual("'awslint.lib.App'");
    });

    it('should return successfully for a short path', () => {
      // GIVEN
      // This path is missing /lib, but it will still work
      const filePath = '/local/home/user/cdk/aws-cdk/packages/@aws-cdk/aws-amplify-alpha/app.ts';
      const className = 'App';

      // WHEN
      const injectionId = (updater as any).filePathToInjectionId(filePath, className);

      // THEN
      expect(injectionId).toEqual("'@aws-cdk.aws-amplify-alpha.App'");
    });

    it('should throw error for bad filepath', () => {
      // GIVEN
      const filePath = 'cdk/aws-cdk/packages/aws-cdk-lib/aws-apigateway';
      const className = 'ApiKey';

      // WHEN THEN
      expect(() => (updater as any).filePathToInjectionId(filePath, className))
      .toThrow('Could not build PROPERTY_INJECTION_ID for cdk/aws-cdk/packages/aws-cdk-lib/aws-apigateway ApiKey');
    });

    it('should throw error for bad filepath 2', () => {
      // GIVEN
      const filePath = 'cdk/aws-cdk/packages/aws-cdk-lib/api-keys.ts';
      const className = 'ApiKey';

      // WHEN THEN
      expect(() => (updater as any).filePathToInjectionId(filePath, className))
      .toThrow('Could not build PROPERTY_INJECTION_ID for cdk/aws-cdk/packages/aws-cdk-lib/api-keys.ts ApiKey');
    });

    it('should throw error for undefined className', () => {
      // GIVEN
      const filePath = 'cdk/aws-cdk/packages/aws-cdk-lib/aws-apigateway';
      const className = undefined;

      // WHEN THEN
      expect(() => (updater as any).filePathToInjectionId(filePath, className))
      .toThrow('Could not build PROPERTY_INJECTION_ID if className is undefined');
    });
  });

  describe('isAlreadyInjectable', () => {
    it('should return true', () => {
      // GIVEN
      const mockProperty1 = {
        getName: jest.fn().mockReturnValue('Property1'),
      } as any;

      const mockProperty2 = {
        getName: jest.fn().mockReturnValue('PROPERTY_INJECTION_ID'),
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('TestClass'),
        getProperties: jest.fn().mockReturnValue([mockProperty1, mockProperty2])
      } as any;

      // WHEN
      const result = (updater as any).isAlreadyInjectable(mockClassDeclaration);

      //THEN
      expect(result).toBe(true);
    });

    it('should return false', () => {
      // GIVEN
      const mockProperty1 = {
        getName: jest.fn().mockReturnValue('Property1'),
      } as any;

      const mockProperty2 = {
        getName: jest.fn().mockReturnValue('INJECTION_ID'),
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('TestClass'),
        getProperties: jest.fn().mockReturnValue([mockProperty1, mockProperty2])
      } as any;

      // WHEN
      const result = (updater as any).isAlreadyInjectable(mockClassDeclaration);

      // THEN
      expect(result).toBe(false);
    });
  });

  describe('importCoreLibFile', () => {
    it('should be inserted in the correct place', () => {
      // GIVEN
      const filePath = '/local/home/user/cdk/aws-cdk/packages/aws-cdk-lib/aws-apigateway/lib/api-key.ts';
      const relativePath = '../../core/lib/prop-injectable';

      const module1 = {
        getText: jest.fn().mockReturnValue('../../core/lib/errors'),
        getLiteralText: jest.fn().mockReturnValue('../../core/lib/errors'),
      } as any;
      const import1 = {
        getModuleSpecifier: jest.fn().mockReturnValue(module1),
      } as any;

      const module2 = {
        getText: jest.fn().mockReturnValue('../../core/lib/removal-policies'),
        getLiteralText: jest.fn().mockReturnValue('../../core/lib/removal-policies'),
      } as any;
      const import2 = {
        getModuleSpecifier: jest.fn().mockReturnValue(module2),
      } as any;

      mockSourceFile = {
        forEachChild: jest.fn((callback) => callback(mockClassDeclaration)),
        getImportDeclarations: jest.fn().mockReturnValue([import1, import2]),
        addImportDeclaration: jest.fn(),
        saveSync: jest.fn(),
        insertImportDeclaration: jest.fn()
      } as any;

      // Setup spies to return the relative path
      const updaterSpy = jest.spyOn(updater as any, 'getRelativePathForPropInjectionImport');
      updaterSpy.mockReturnValueOnce(relativePath);

      // WHEN
      (updater as any).importCoreLibFile(mockSourceFile, filePath, 'prop-injectable', 'propertyInjectable');

      // THEN
      expect(mockSourceFile.insertImportDeclaration).toHaveBeenCalledWith(
        1,
        {
          moduleSpecifier: relativePath,
          namedImports: [{ name: "propertyInjectable" }],
        },
      );
    });
  });

  describe('makeConstructsPropInjectable', () => {
    it('should skip because class already has PROPERTY_INJECTION_ID', () => {
      // GIVEN
      const filePath = '/local/home/user/cdk/aws-cdk/packages/aws-cdk-lib/aws-apigateway/lib/api-key.ts';

      const mockProperty1 = {
        getName: jest.fn().mockReturnValue('Property1'),
      } as any;

      const mockProperty2 = {
        getName: jest.fn().mockReturnValue('PROPERTY_INJECTION_ID'),
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('TestClass'),
        getProperties: jest.fn().mockReturnValue([mockProperty1, mockProperty2]),
        addProperty: jest.fn(),
        addDecorator: jest.fn(),
      } as any;

      mockSourceFile = {
        forEachChild: jest.fn((callback) => callback(mockClassDeclaration)),
        getImportDeclarations: jest.fn().mockReturnValue([]),
        addImportDeclaration: jest.fn(),
        saveSync: jest.fn(),
        insertImportDeclaration: jest.fn()
      } as any;

      // WHEN
      (updater as any).makeConstructsPropInjectable(mockSourceFile, filePath, mockClassDeclaration);

      // THEN
      expect(mockClassDeclaration.addProperty).not.toHaveBeenCalled();
      expect(mockClassDeclaration.addDecorator).not.toHaveBeenCalled();
      expect(mockSourceFile.insertImportDeclaration).not.toHaveBeenCalled();
    });

    it('should add PROPERTY_INJECTION_ID, import and class decorator', () => {
      // GIVEN
      const filePath = '/local/home/user/cdk/aws-cdk/packages/aws-cdk-lib/aws-apigateway/lib/api-key.ts';
      const relativePath = '../../core/lib/prop-injectable';

      const mockProperty1 = {
        getName: jest.fn().mockReturnValue('Property1'),
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('TestClass'),
        getProperties: jest.fn().mockReturnValue([mockProperty1]),
        insertProperty: jest.fn(),
        addDecorator: jest.fn(),
      } as any;

      const module1 = {
        getText: jest.fn().mockReturnValue('../../core/lib/errors'),
        getLiteralText: jest.fn().mockReturnValue('../../core/lib/errors'),
      } as any;
      const import1 = {
        getModuleSpecifier: jest.fn().mockReturnValue(module1),
      } as any;

      mockSourceFile = {
        forEachChild: jest.fn((callback) => callback(mockClassDeclaration)),
        getImportDeclarations: jest.fn().mockReturnValue([import1]),
        addImportDeclaration: jest.fn(),
        saveSync: jest.fn(),
        insertImportDeclaration: jest.fn()
      } as any;

      // Setup spies to return the relative path
      const updaterSpy = jest.spyOn(updater as any, 'getRelativePathForPropInjectionImport');
      updaterSpy.mockReturnValueOnce(relativePath);

      const shouldBeSkippedSpy = jest.spyOn(updater as any, 'shouldBeSkippedToBeInjectable');
      shouldBeSkippedSpy.mockReturnValueOnce(false);

      // WHEN
      (updater as any).makeConstructsPropInjectable(mockSourceFile, filePath, mockClassDeclaration);

      // THEN
      expect(mockClassDeclaration.insertProperty).toHaveBeenCalled();
      expect(mockClassDeclaration.addDecorator).toHaveBeenCalled();
      expect(mockSourceFile.addImportDeclaration).toHaveBeenCalled();
    });
  });

  describe('shouldBeSkippedToBeInjectable', () => {
    it('should return true for classes in NOT_INJECTABLE_CLASSES list', () => {
      // GIVEN
      const mockSourceFile = {
        getFilePath: jest.fn().mockReturnValue('/some/path/packages/aws-cdk-lib/aws-apigateway/lib/restapi.ts')
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('RootResource'),
        getSourceFile: jest.fn().mockReturnValue(mockSourceFile)
      } as any;

      // WHEN
      const result = (updater as any).shouldBeSkippedToBeInjectable(mockClassDeclaration);

      // THEN
      expect(result).toBe(true);
    });

    it('should return true for LatestVersion class in function-base.ts', () => {
      // GIVEN
      const mockSourceFile = {
        getFilePath: jest.fn().mockReturnValue('/some/path/packages/aws-cdk-lib/aws-lambda/lib/function-base.ts')
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('LatestVersion'),
        getSourceFile: jest.fn().mockReturnValue(mockSourceFile)
      } as any;

      // WHEN
      const result = (updater as any).shouldBeSkippedToBeInjectable(mockClassDeclaration);

      // THEN
      expect(result).toBe(true);
    });

    it('should return false for classes not in NOT_INJECTABLE_CLASSES list', () => {
      // GIVEN
      const mockSourceFile = {
        getFilePath: jest.fn().mockReturnValue('/some/path/packages/aws-cdk-lib/aws-lambda/lib/function.ts')
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('Function'),
        getSourceFile: jest.fn().mockReturnValue(mockSourceFile)
      } as any;

      // WHEN
      const result = (updater as any).shouldBeSkippedToBeInjectable(mockClassDeclaration);

      // THEN
      expect(result).toBe(false);
    });

    it('should return false for classes with matching name but different path', () => {
      // GIVEN
      const mockSourceFile = {
        getFilePath: jest.fn().mockReturnValue('/some/path/packages/aws-cdk-lib/aws-s3/lib/bucket.ts')
      } as any;

      mockClassDeclaration = {
        getName: jest.fn().mockReturnValue('RootResource'),
        getSourceFile: jest.fn().mockReturnValue(mockSourceFile)
      } as any;

      // WHEN
      const result = (updater as any).shouldBeSkippedToBeInjectable(mockClassDeclaration);

      // THEN
      expect(result).toBe(false);
    });
  });
});

describe('PropertyUpdater', () => {
  let propertyUpdater: PropertyUpdater;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    propertyUpdater = new PropertyUpdater('/mock/dir');
  });

  describe('execute', () => {
    it('should process source files and generate content', () => {
      // Mock the source files
      const mockSourceFiles = [
        {
          getFilePath: () => '/packages/aws-cdk-lib/aws-lambda/Function.ts'
        }
      ] as any;

      // Mock getCdkResourceClasses to return test data
      const mockClasses = [{
        filePath: '/packages/aws-cdk-lib/aws-lambda/Function.ts',
        node: {
          getConstructors: () => [{
            getParameters: () => []
          }],
          getMethods: () => [],
        },
        className: 'Function'
      }];

      // Setup spies
      const getSourceFilesSpy = jest.spyOn(propertyUpdater['project'], 'getSourceFiles')
        .mockReturnValue(mockSourceFiles);
      const getCdkResourceClassesSpy = jest.spyOn(propertyUpdater as any, 'getCdkResourceClasses')
        .mockReturnValue(mockClasses);
      const extractConstructorPropsSpy = jest.spyOn(propertyUpdater as any, 'extractConstructorProps');
      const generateFileContentSpy = jest.spyOn(propertyUpdater as any, 'generateFileContent');

      // Execute the method
      propertyUpdater.execute();

      // Assertions
      expect(getSourceFilesSpy).toHaveBeenCalled();
      expect(getCdkResourceClassesSpy).toHaveBeenCalledWith('/packages/aws-cdk-lib/aws-lambda/Function.ts');
      expect(extractConstructorPropsSpy).toHaveBeenCalled();
      expect(generateFileContentSpy).toHaveBeenCalled();
    });
  });

  describe('getModuleName', () => {
    it('should extract correct module name from file path', () => {
      const testCases = [
        {
          input: 'packages/aws-cdk-lib/aws-lambda/lib/function.ts',
          expected: 'aws-cdk-lib.aws-lambda'
        },
        {
          input: 'packages/aws-cdk-lib/core/lib/resource.ts',
          expected: 'aws-cdk-lib.core'
        }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = propertyUpdater['getModuleName'](input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('generateFileContent', () => {
    it('should generate correct file content and write to file', () => {
      // Mock the classProps
      propertyUpdater['classProps'] = {
        'aws-cdk-lib.aws-lambda': {
          Function: {
            handler: '*',
            runtime: '*'
          }
        }
      };

      // Mock path.resolve
      (path.resolve as jest.Mock).mockReturnValue('/mock/output/path');

      // Execute the method
      propertyUpdater['generateFileContent']();

      // Verify file write
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/mock/output/path',
        expect.stringContaining('AWS_CDK_CONSTRUCTOR_PROPS')
      );

      // Verify content format
      const writeCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
      const content = writeCall[1];

      expect(content).toContain('eslint-disable');
      expect(content).toContain('AWS_CDK_CONSTRUCTOR_PROPS');
      expect(content).toContain("'aws-cdk-lib.aws-lambda'");
    });
  });

  describe('extractConstructorProps', () => {
    it('should extract and store constructor props correctly', () => {
      // Mock the necessary data
      const mockFilePath = '/packages/aws-cdk-lib/aws-lambda/lib/Function.ts';
      const mockNode = {
        getConstructors: () => [{
          getParameters: () => [{
            getType: () => ({
              getProperties: () => []
            })
          }]
        }]
      };
      const mockClassName = 'Function';

      // Mock parseConstructorProps to return some test data
      jest.spyOn(propertyUpdater as any, 'parseConstructorProps')
        .mockReturnValue({
          Function: { prop1: '*', prop2: '*' }
        });

      // Execute the method
      propertyUpdater['extractConstructorProps'](mockFilePath, mockNode as any, mockClassName);

      // Verify the classProps were updated correctly
      expect(propertyUpdater['classProps']['aws-cdk-lib.aws-lambda']).toEqual({
        Function: { prop1: '*', prop2: '*' }
      });
    });

    it('should handle case when parseConstructorProps returns undefined', () => {
      const mockFilePath = '/packages/aws-cdk-lib/aws-lambda/Function.ts';
      const mockNode = {
        getConstructors: () => []
      };
      const mockClassName = 'Function';

      // Mock parseConstructorProps to return undefined
      jest.spyOn(propertyUpdater as any, 'parseConstructorProps')
        .mockReturnValue(undefined);

      // Execute the method
      propertyUpdater['extractConstructorProps'](mockFilePath, mockNode as any, mockClassName);

      // Verify the classProps weren't updated
      expect(propertyUpdater['classProps']['aws-cdk-lib.aws-lambda']).toBeUndefined();
    });
  });

  describe('getPropertyType', () => {
    it('should handle union types of boolean', () => {
      const mockType = {
        isUnion: () => true,
        isBoolean: () => false,
        getUnionTypes: () => [{
          getText: () => 'true',
          isLiteral: () => true,
          isBoolean: () => false,
          isArray: () => false,
          isClass: () => false,
          isInterface: () => false,
        }, {
          getText: () => 'undefined',
          isLiteral: () => true,
          isArray: () => false,
          isBoolean: () => false,
          isClass: () => false,
          isInterface: () => false,
        }],
      };

      const result = propertyUpdater['getPropertyType'](mockType);
      expect(result).toBe('boolean');
    });

    it('should handle union types of string', () => {
      const mockType = {
        isUnion: () => true,
        isBoolean: () => false,
        getUnionTypes: () => [{
          getText: () => 'string',
          isLiteral: () => true,
          isBoolean: () => false,
          getSymbol: () => undefined,
          isArray: () => false,
          isClass: () => false,
          isInterface: () => false,
        }, {
          getText: () => 'undefined',
          isLiteral: () => true,
          isArray: () => false,
          isBoolean: () => false,
          isClass: () => false,
          isInterface: () => false,
        }],
      };

      const result = propertyUpdater['getPropertyType'](mockType);
      expect(result).toBe('*');
    });

    it('should handle array types', () => {
      const mockType = {
        isUnion: () => false,
        isArray: () => true,
        isBoolean: () => false,
        getSymbol: () => false,
        getArrayElementType: () => ({
          getText: () => 'string',
          isUnion: () => false,
          isBoolean: () => false,
          getSymbol: () => false,
          isLiteral: () => false,
          isArray: () => false,
          isClass: () => false,
          isInterface: () => false,
        })
      };

      const result = propertyUpdater['getPropertyType'](mockType);
      expect(result).toBe('*');
    });

    it('should handle cycle detection', () => {
      const processedTypes = new Set(['TestType']);
      const mockType = {
        isUnion: () => false,
        isArray: () => false,
        isClass: () => true,
        isBoolean: () => false,
        getSymbol: () => ({
          getFullyQualifiedName: () => 'TestType',
          getDeclarations: () => []
        })
      };

      const result = propertyUpdater['getPropertyType'](mockType, processedTypes);
      expect(result).toBeUndefined();
    });
  });
});

describe('EnumLikeUpdater', () => {
  let enumLikeUpdater: EnumLikeUpdater;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    enumLikeUpdater = new EnumLikeUpdater('/mock/dir');
  });

  describe('execute', () => {
    it('should process source files and generate content', () => {
      // Mock the source files
      const mockSourceFiles = [
        {
          getFilePath: () => '/aws-cdk/packages/aws-cdk-lib/aws-lambda/Function.ts',
          forEachChild: jest.fn(() => {})
        }
      ] as any;

      // Setup spies
      const getSourceFilesSpy = jest.spyOn(enumLikeUpdater['project'], 'getSourceFiles')
        .mockReturnValue(mockSourceFiles);
      const generateFileContentSpy = jest.spyOn(enumLikeUpdater as any, 'writeFileContent');

      // Execute the method
      enumLikeUpdater.execute();

      // Assertions
      expect(getSourceFilesSpy).toHaveBeenCalled();
      expect(generateFileContentSpy).toHaveBeenCalled();
    });
  });

  describe('generateFileContent', () => {
    it('should generate correct file content and write to file', () => {
      // Mock the enumLikes
      let enumlikes = {
        'aws-cdk/some-module/enum': {
          'Enum': [
            'value'
          ],
        },
      };

      // Mock path.resolve
      (path.resolve as jest.Mock).mockReturnValue('/mock/output/path');

      // Execute the method
      enumLikeUpdater['writeFileContent']('/mock/output/path', enumlikes);

      // Verify file write
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/mock/output/path',
        expect.stringContaining('aws-cdk/some-module/enum')
      );

      // Verify content format
      const writeCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
      const content = writeCall[1];

      expect(content).toContain('"aws-cdk/some-module/enum"');
      expect(content).toContain('"Enum"');
      expect(content).toContain('"value"');
    });
  });
});